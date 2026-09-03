//! Lectura, escritura y clasificación de variables de entorno.
//!
//! El panel guarda las variables en SQLite (la «bóveda») y las sincroniza con
//! los ficheros `.env` del proyecto. La razón de tener bóveda y no ser solo un
//! editor de ficheros: al borrar un proyecto se hace `remove_dir_all` de su
//! carpeta, el `.env` está en el `.gitignore` que genera este mismo panel y por
//! tanto tampoco está en GitHub. Sin una copia fuera del árbol del proyecto,
//! esos secretos se pierden para siempre.
//!
//! Aquí vive solo lo que no toca la base de datos: el formato dotenv y la
//! heurística de qué parece un secreto. La persistencia está en
//! [`crate::storage`].

use crate::domain::{EnvFileInfo, EnvVar};
use std::collections::HashMap;
use std::path::Path;

/// Ficheros de entorno que se ofrecen para importar. Se descubren leyendo el
/// directorio, no con esta lista: sirve solo para reconocer los nombres que son
/// plantillas públicas y no una fuente de secretos.
const TEMPLATE_SUFFIXES: &[&str] = &["example", "sample", "template", "dist", "defaults"];

/// Nombre de fichero de entorno por omisión cuando se añade una variable a mano.
pub const DEFAULT_SCOPE: &str = ".env";

/// Una variable tal y como aparece en un fichero, antes de entrar en la bóveda.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedEnvVar {
    pub key: String,
    pub value: String,
    /// Comentario que precedía a la variable en el fichero. Se conserva porque
    /// suele ser la única documentación de para qué sirve la clave.
    pub comment: Option<String>,
}

/// Sufijo de las copias que deja [`crate::commands::env_vars::write_env_file`]
/// antes de sobrescribir un fichero. Esas copias viven en el directorio de
/// datos de la aplicación, no en el proyecto.
pub const BACKUP_SUFFIX: &str = ".bak";

/// ¿Es un nombre de fichero de entorno? (`.env`, `.env.local`, `.env.production`)
///
/// Un `.env.local.bak` hecho a mano queda fuera a propósito: no es un fichero
/// que el proyecto lea, y ofrecerlo como un ámbito más que importar solo
/// duplicaría claves en la bóveda.
pub fn is_env_file_name(name: &str) -> bool {
    if name.ends_with(BACKUP_SUFFIX) {
        return false;
    }
    name == ".env" || name.starts_with(".env.")
}

/// ¿Se puede usar este nombre como ámbito?
///
/// La interfaz manda el nombre del fichero y con él se construye una ruta
/// dentro del proyecto, así que hay que descartar separadores y `..` antes de
/// tocar el disco: un ámbito `../../.ssh/config` escribiría fuera del árbol.
pub fn is_valid_scope(scope: &str) -> bool {
    !scope.contains(['/', '\\', '\0'])
        && scope != ".."
        && !scope.contains("..")
        && is_env_file_name(scope)
}

/// ¿Es una plantilla pública (`.env.example`) en vez de un fichero con valores
/// reales? Importarla sigue siendo útil —da la lista de claves que el proyecto
/// espera— pero no se trata como fuente de secretos.
pub fn is_template_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    TEMPLATE_SUFFIXES.iter().any(|suffix| lower.ends_with(&format!(".{suffix}")))
}

/// Precedencia de un fichero de entorno al fusionar variables para ejecutar.
///
/// Sigue el orden que usan Vite, Next y dotenv-flow: lo más específico gana.
/// `.env` es la base, un fichero de modo (`.env.production`) lo pisa, y los
/// `.local` —que nunca se commitean— pisan a todos.
pub fn scope_rank(scope: &str) -> u8 {
    let lower = scope.to_lowercase();
    match () {
        _ if lower == ".env" => 0,
        _ if lower == ".env.local" => 20,
        _ if lower.ends_with(".local") => 30,
        _ => 10,
    }
}

/// Segmentos de nombre que delatan un secreto. Se comparan como piezas
/// completas del nombre (separadas por `_` o `-`), no como subcadenas: buscar
/// «KEY» dentro del nombre marcaba `MONKEY_NAME` y buscar «AUTH» marcaba
/// `AUTHOR_EMAIL`.
const SECRET_SEGMENTS: &[&str] = &[
    "TOKEN", "SECRET", "SECRETS", "PASSWORD", "PASSWD", "PASS", "PASSPHRASE", "KEY", "KEYS",
    "APIKEY", "CREDENTIAL", "CREDENTIALS", "PRIVATE", "DSN", "SALT", "SIGNATURE", "SIGNING",
    "CERT", "CERTIFICATE", "JWT", "AUTH", "SESSION", "COOKIE", "ENCRYPTION", "CIPHER", "OTP",
];

/// Nombres sin separadores donde la comparación por segmentos no llega.
const SECRET_SUBSTRINGS: &[&str] = &["TOKEN", "SECRET", "PASSWORD", "APIKEY", "PRIVATEKEY"];

/// ¿Debe ocultarse este valor en la interfaz?
///
/// El sesgo es deliberado hacia el falso positivo: enmascarar de más solo
/// obliga a pulsar «revelar», mientras que enmascarar de menos deja una
/// credencial a la vista en una captura de pantalla.
pub fn is_secret_key(key: &str, value: &str) -> bool {
    let upper = key.to_uppercase();
    if upper
        .split(['_', '-', '.'])
        .any(|segment| SECRET_SEGMENTS.contains(&segment))
    {
        return true;
    }
    if SECRET_SUBSTRINGS.iter().any(|hint| upper.contains(hint)) {
        return true;
    }
    // Una URL de conexión lleva la contraseña incrustada: `DATABASE_URL` no
    // dispara ninguna de las reglas por nombre, pero
    // `postgres://user:pass@host` sí es un secreto.
    url_carries_credentials(value)
}

/// Detecta `esquema://usuario:contraseña@host` sin recurrir a una expresión
/// regular (la caja de herramientas del proyecto no trae una).
fn url_carries_credentials(value: &str) -> bool {
    let Some((_, rest)) = value.split_once("://") else { return false };
    let Some((authority, _)) = rest.split_once('@') else { return false };
    if authority.is_empty() || authority.contains('/') {
        return false;
    }
    authority
        .split_once(':')
        .is_some_and(|(user, password)| !user.is_empty() && !password.is_empty())
}

/// Interpreta el contenido de un fichero `.env`.
///
/// Cubre lo que aparece en la práctica: `export` al principio, comentarios de
/// línea completa y en línea, valores entre comillas simples o dobles y valores
/// entre comillas que ocupan varias líneas (una clave privada PEM pegada tal
/// cual). Una línea cuya clave no es un identificador válido se descarta en
/// silencio: es texto suelto, no una variable.
pub fn parse_env_content(content: &str) -> Vec<ParsedEnvVar> {
    let mut variables: Vec<ParsedEnvVar> = Vec::new();
    let mut pending_comment: Vec<String> = Vec::new();
    let mut lines = content.lines().peekable();

    while let Some(raw_line) = lines.next() {
        let line = raw_line.trim();
        if line.is_empty() {
            // Una línea en blanco corta el bloque de comentario: lo que había
            // arriba documentaba otra cosa, no la siguiente variable.
            pending_comment.clear();
            continue;
        }
        if let Some(comment) = line.strip_prefix('#') {
            pending_comment.push(comment.trim().to_string());
            continue;
        }

        let assignment = line.strip_prefix("export ").unwrap_or(line);
        let Some((raw_key, raw_value)) = assignment.split_once('=') else {
            pending_comment.clear();
            continue;
        };
        let key = raw_key.trim();
        if !is_valid_key(key) {
            pending_comment.clear();
            continue;
        }

        let value = read_value(raw_value.trim(), &mut lines);
        let comment = if pending_comment.is_empty() { None } else { Some(pending_comment.join(" ")) };
        pending_comment.clear();

        // Una clave repetida en el mismo fichero: gana la última, como en
        // dotenv. Se reemplaza en su sitio para no duplicar la fila.
        if let Some(existing) = variables.iter_mut().find(|existing| existing.key == key) {
            existing.value = value;
            if comment.is_some() {
                existing.comment = comment;
            }
        } else {
            variables.push(ParsedEnvVar { key: key.to_string(), value, comment });
        }
    }

    variables
}

/// Un nombre de variable válido: letra o `_` al principio, después
/// alfanuméricos y `_`.
pub fn is_valid_key(key: &str) -> bool {
    let mut characters = key.chars();
    let Some(first) = characters.next() else { return false };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

/// Lee el valor de una asignación, consumiendo líneas adicionales si las
/// comillas no se cierran en la primera.
fn read_value<'a>(first: &str, lines: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>) -> String {
    let mut characters = first.chars();
    match characters.next() {
        Some('"') => read_quoted(first, lines, '"', true),
        Some('\'') => read_quoted(first, lines, '\'', false),
        // Sin comillas, un `#` empieza un comentario en línea. Pegado al valor
        // (`PORT=3000#comentario`) forma parte del valor, igual que en dotenv:
        // solo cuenta si va precedido de un espacio.
        _ => match first.split_once(" #") {
            Some((value, _)) => value.trim().to_string(),
            None => first.to_string(),
        },
    }
}

/// Consume desde la comilla de apertura hasta la de cierre, uniendo líneas si
/// hace falta. Con `unescape` se traducen las secuencias `\n`, `\t`… que solo
/// tienen sentido dentro de comillas dobles.
fn read_quoted<'a>(
    first: &str,
    lines: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>,
    quote: char,
    unescape: bool,
) -> String {
    let mut buffer = String::new();
    let mut segment = &first[quote.len_utf8()..];
    loop {
        match find_closing_quote(segment, quote, unescape) {
            Some(index) => {
                buffer.push_str(&segment[..index]);
                break;
            }
            None => {
                buffer.push_str(segment);
                // Comilla sin cerrar y sin más líneas: se devuelve lo leído en
                // vez de descartar la variable. Un fichero mal formado no debe
                // hacer desaparecer una credencial de la vista.
                let Some(next) = lines.next() else { break };
                buffer.push('\n');
                segment = next;
            }
        }
    }
    if unescape { unescape_double_quoted(&buffer) } else { buffer }
}

fn find_closing_quote(segment: &str, quote: char, honour_escapes: bool) -> Option<usize> {
    let mut escaped = false;
    for (index, character) in segment.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if honour_escapes && character == '\\' {
            escaped = true;
            continue;
        }
        if character == quote {
            return Some(index);
        }
    }
    None
}

fn unescape_double_quoted(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            result.push(character);
            continue;
        }
        match characters.next() {
            Some('n') => result.push('\n'),
            Some('r') => result.push('\r'),
            Some('t') => result.push('\t'),
            Some('0') => result.push('\0'),
            Some(other) => result.push(other),
            None => result.push('\\'),
        }
    }
    result
}

/// Escribe las variables en formato dotenv, listas para guardarse en disco o
/// copiarse al portapapeles.
///
/// Las deshabilitadas salen comentadas en vez de desaparecer: así el fichero
/// sigue documentando que la clave existe, y al reimportar no vuelven a
/// activarse solas (la importación fusiona, nunca borra).
pub fn serialize_env_vars(vars: &[EnvVar]) -> String {
    let mut output = String::new();
    for variable in vars {
        if let Some(comment) = variable.comment.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
            for line in comment.lines() {
                output.push_str("# ");
                output.push_str(line.trim());
                output.push('\n');
            }
        }
        if !variable.is_enabled {
            output.push_str("# (deshabilitada en Dev Command Center)\n# ");
        }
        output.push_str(&variable.key);
        output.push('=');
        output.push_str(&quote_value(&variable.value));
        output.push('\n');
    }
    output
}

/// Entrecomilla solo cuando hace falta: un `.env` se lee a mano constantemente
/// y poner comillas a todo lo vuelve ilegible.
fn quote_value(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let needs_quotes = value.contains([' ', '\t', '"', '\'', '#', '\n', '\r'])
        || value.starts_with('$')
        || value != value.trim();
    if !needs_quotes {
        return value.to_string();
    }
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    format!("\"{escaped}\"")
}

/// Ficheros de entorno presentes en la raíz del proyecto, cruzados con lo que
/// hay en la bóveda para poder decir si están sincronizados.
///
/// Solo la raíz: recorrer el árbol completo encontraría los `.env` de fixtures
/// de test y de `node_modules`, que no son configuración del proyecto.
pub fn inspect_env_files(root: &Path, vault: &[EnvVar]) -> Vec<EnvFileInfo> {
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new() };
    let mut files: Vec<EnvFileInfo> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_env_file_name(&name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        if !metadata.is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(entry.path()) else { continue };
        let on_disk = parse_env_content(&content);
        let in_vault: HashMap<&str, &EnvVar> = vault
            .iter()
            .filter(|variable| variable.scope == name)
            .map(|variable| (variable.key.as_str(), variable))
            .collect();

        let mut missing_in_vault = Vec::new();
        let mut differing = Vec::new();
        for variable in &on_disk {
            match in_vault.get(variable.key.as_str()) {
                None => missing_in_vault.push(variable.key.clone()),
                Some(stored) if stored.value != variable.value => differing.push(variable.key.clone()),
                Some(_) => {}
            }
        }
        let only_in_vault = in_vault
            .keys()
            .filter(|key| !on_disk.iter().any(|variable| variable.key == **key))
            .map(|key| (*key).to_string())
            .collect();

        files.push(EnvFileInfo {
            name: name.clone(),
            path: entry.path().to_string_lossy().to_string(),
            is_template: is_template_file(&name),
            size_bytes: metadata.len(),
            file_var_count: on_disk.len(),
            vault_var_count: in_vault.len(),
            missing_in_vault,
            differing,
            only_in_vault,
        });
    }

    // Los ficheros que solo existen en la bóveda —importados antes de borrar la
    // carpeta, o creados a mano— también deben aparecer: son un destino válido
    // para «escribir al disco».
    for scope in vault.iter().map(|variable| variable.scope.as_str()) {
        if files.iter().any(|file| file.name == scope) {
            continue;
        }
        let vault_keys: Vec<String> = vault
            .iter()
            .filter(|variable| variable.scope == scope)
            .map(|variable| variable.key.clone())
            .collect();
        files.push(EnvFileInfo {
            name: scope.to_string(),
            path: root.join(scope).to_string_lossy().to_string(),
            is_template: is_template_file(scope),
            size_bytes: 0,
            file_var_count: 0,
            vault_var_count: vault_keys.len(),
            missing_in_vault: Vec::new(),
            differing: Vec::new(),
            only_in_vault: vault_keys,
        });
    }

    files.sort_by(|left, right| scope_rank(&left.name).cmp(&scope_rank(&right.name)).then(left.name.cmp(&right.name)));
    files
}

/// Fusiona las variables de la bóveda en el mapa que recibirá el proceso hijo.
///
/// Las deshabilitadas se quedan fuera, las plantillas también (`.env.example`
/// no lleva valores reales) y el orden lo fija [`scope_rank`], de modo que un
/// `.env.local` pise al `.env`.
pub fn merge_for_process(vars: &[EnvVar]) -> HashMap<String, String> {
    let mut ordered: Vec<&EnvVar> = vars
        .iter()
        .filter(|variable| variable.is_enabled && !is_template_file(&variable.scope))
        .collect();
    ordered.sort_by_key(|variable| scope_rank(&variable.scope));
    ordered
        .into_iter()
        .map(|variable| (variable.key.clone(), variable.value.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_var(scope: &str, key: &str, value: &str) -> EnvVar {
        EnvVar {
            id: format!("{scope}:{key}"),
            project_id: Some("p1".into()),
            scope: scope.into(),
            key: key.into(),
            value: value.into(),
            is_secret: false,
            is_enabled: true,
            comment: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            origin_project_name: None,
            origin_project_path: None,
            orphaned_at: None,
        }
    }

    #[test]
    fn parses_the_shapes_that_appear_in_real_env_files() {
        let parsed = parse_env_content(
            r#"
# Base de datos del entorno local
DATABASE_URL=postgres://user:pass@localhost:5432/db
export PORT=3001
QUOTED="con espacios y # almohadilla"
SINGLE='sin $interpolar'
INLINE=valor # esto es un comentario
PEGADO=valor#no-es-comentario
EMPTY=
no-es-una-clave=descartada
1INVALIDA=descartada
"#,
        );

        let by_key: HashMap<&str, &str> = parsed.iter().map(|v| (v.key.as_str(), v.value.as_str())).collect();
        assert_eq!(by_key.get("DATABASE_URL").copied(), Some("postgres://user:pass@localhost:5432/db"));
        assert_eq!(by_key.get("PORT").copied(), Some("3001"), "el prefijo export debe ignorarse");
        assert_eq!(by_key.get("QUOTED").copied(), Some("con espacios y # almohadilla"));
        assert_eq!(by_key.get("SINGLE").copied(), Some("sin $interpolar"));
        assert_eq!(by_key.get("INLINE").copied(), Some("valor"), "un ' #' cierra el valor");
        assert_eq!(by_key.get("PEGADO").copied(), Some("valor#no-es-comentario"), "sin espacio no es comentario");
        assert_eq!(by_key.get("EMPTY").copied(), Some(""));
        assert!(!by_key.contains_key("no-es-una-clave"));
        assert!(!by_key.contains_key("1INVALIDA"));

        let documented = parsed.iter().find(|v| v.key == "DATABASE_URL").expect("DATABASE_URL");
        assert_eq!(documented.comment.as_deref(), Some("Base de datos del entorno local"));
    }

    /// Una clave privada pegada tal cual ocupa veinte líneas entre comillas. Si
    /// el parser corta en la primera, la credencial que se guarda está truncada
    /// y el proyecto restaurado no arranca.
    #[test]
    fn reads_a_quoted_value_that_spans_several_lines() {
        let parsed = parse_env_content("PRIVATE_KEY=\"-----BEGIN KEY-----\nlinea1\nlinea2\n-----END KEY-----\"\nOTRA=1\n");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].value, "-----BEGIN KEY-----\nlinea1\nlinea2\n-----END KEY-----");
        assert_eq!(parsed[1].key, "OTRA");
    }

    #[test]
    fn a_repeated_key_keeps_the_last_value_like_dotenv() {
        let parsed = parse_env_content("PORT=3000\nPORT=4000\n");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].value, "4000");
    }

    /// Serializar y volver a leer no debe cambiar ningún valor: es lo que ocurre
    /// al escribir la bóveda al disco y reimportarla después.
    #[test]
    fn serializing_and_parsing_again_preserves_every_value() {
        let originals = vec![
            vault_var(".env", "PLAIN", "simple"),
            vault_var(".env", "SPACED", "con espacios"),
            vault_var(".env", "HASHED", "valor # con almohadilla"),
            vault_var(".env", "QUOTES", "dice \"hola\""),
            vault_var(".env", "MULTILINE", "linea1\nlinea2"),
            vault_var(".env", "EMPTY", ""),
            vault_var(".env", "DOLLAR", "$NO_INTERPOLAR"),
        ];

        let reparsed = parse_env_content(&serialize_env_vars(&originals));

        assert_eq!(reparsed.len(), originals.len());
        for original in &originals {
            let found = reparsed.iter().find(|v| v.key == original.key).unwrap_or_else(|| panic!("falta {}", original.key));
            assert_eq!(found.value, original.value, "clave {}", original.key);
        }
    }

    #[test]
    fn a_disabled_variable_is_written_commented_out() {
        let mut disabled = vault_var(".env", "FEATURE_FLAG", "on");
        disabled.is_enabled = false;
        let text = serialize_env_vars(&[disabled]);
        assert!(text.contains("# FEATURE_FLAG=on"), "{text}");
        assert!(parse_env_content(&text).is_empty(), "comentada no debe reimportarse activa");
    }

    /// El ámbito llega desde la interfaz y con él se construye una ruta dentro
    /// del proyecto. Sin validarlo se podría escribir fuera del árbol.
    #[test]
    fn rejects_a_scope_that_could_escape_the_project_folder() {
        assert!(is_valid_scope(".env"));
        assert!(is_valid_scope(".env.local"));
        assert!(is_valid_scope(".env.production.local"));
        assert!(!is_valid_scope("../.env"));
        assert!(!is_valid_scope(".env/../../.ssh/config"));
        assert!(!is_valid_scope("package.json"));
        assert!(!is_valid_scope(""));
        assert!(!is_valid_scope(".env.local.bak"), "una copia no es un ámbito");
    }

    #[test]
    fn masks_what_looks_like_a_credential_and_leaves_the_rest_visible() {
        for key in ["API_TOKEN", "STRIPE_SECRET_KEY", "DB_PASSWORD", "JWT_SIGNING_KEY", "SESSION_COOKIE", "GITHUB_TOKEN"] {
            assert!(is_secret_key(key, "x"), "{key} debería ocultarse");
        }
        for key in ["PORT", "NODE_ENV", "MONKEY_NAME", "AUTHOR_EMAIL", "VITE_APP_TITLE", "LOG_LEVEL"] {
            assert!(!is_secret_key(key, "x"), "{key} no debería ocultarse");
        }
        // El nombre no delata nada, pero el valor lleva la contraseña dentro.
        assert!(is_secret_key("DATABASE_URL", "postgres://user:pass@localhost/db"));
        assert!(!is_secret_key("API_BASE_URL", "https://api.example.com/v1"));
    }

    /// Lo específico pisa a lo general, como en Vite y dotenv-flow. Sin este
    /// orden, un `.env` con la base de datos de producción ganaría al
    /// `.env.local` del portátil.
    #[test]
    fn the_local_file_wins_over_the_base_file_when_merging() {
        let merged = merge_for_process(&[
            vault_var(".env", "DATABASE_URL", "produccion"),
            vault_var(".env.local", "DATABASE_URL", "local"),
            vault_var(".env", "PORT", "3000"),
        ]);
        assert_eq!(merged.get("DATABASE_URL").map(String::as_str), Some("local"));
        assert_eq!(merged.get("PORT").map(String::as_str), Some("3000"));
    }

    #[test]
    fn templates_and_disabled_variables_never_reach_the_process() {
        let mut disabled = vault_var(".env", "DISABLED", "1");
        disabled.is_enabled = false;
        let merged = merge_for_process(&[
            disabled,
            vault_var(".env.example", "PLACEHOLDER", "cambiame"),
            vault_var(".env", "REAL", "1"),
        ]);
        assert_eq!(merged.len(), 1);
        assert!(merged.contains_key("REAL"));
    }

    #[test]
    fn reports_which_keys_are_out_of_sync_between_disk_and_vault() {
        let directory = tempfile::tempdir().expect("tempdir");
        std::fs::write(directory.path().join(".env"), "IGUAL=1\nDISTINTA=disco\nSOLO_DISCO=1\n").expect("write");
        std::fs::write(directory.path().join(".env.example"), "IGUAL=\n").expect("write");
        std::fs::write(directory.path().join("no-es-env.txt"), "IGUAL=1\n").expect("write");

        let vault = vec![
            vault_var(".env", "IGUAL", "1"),
            vault_var(".env", "DISTINTA", "boveda"),
            vault_var(".env", "SOLO_BOVEDA", "1"),
        ];
        let files = inspect_env_files(directory.path(), &vault);

        assert_eq!(files.len(), 2, "solo los .env de la raíz: {files:?}");
        let base = files.iter().find(|f| f.name == ".env").expect(".env");
        assert_eq!(base.missing_in_vault, vec!["SOLO_DISCO".to_string()]);
        assert_eq!(base.differing, vec!["DISTINTA".to_string()]);
        assert_eq!(base.only_in_vault, vec!["SOLO_BOVEDA".to_string()]);
        assert!(files.iter().find(|f| f.name == ".env.example").expect("example").is_template);
    }

    /// Un fichero que ya solo existe en la bóveda (el proyecto se borró y se
    /// restauró en otra carpeta) tiene que seguir apareciendo como destino.
    #[test]
    fn a_scope_that_only_exists_in_the_vault_is_still_listed() {
        let directory = tempfile::tempdir().expect("tempdir");
        let files = inspect_env_files(directory.path(), &[vault_var(".env.local", "SOLO_BOVEDA", "1")]);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, ".env.local");
        assert_eq!(files[0].file_var_count, 0);
        assert_eq!(files[0].only_in_vault, vec!["SOLO_BOVEDA".to_string()]);
    }
}
