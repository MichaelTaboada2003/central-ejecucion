//! Comandos expuestos a la interfaz, agrupados por dominio. Antes vivían los 36
//! en `lib.rs`, que era a la vez estado, utilidades de sondeo y arranque.
pub mod disk;
pub mod env_vars;
pub mod git;
pub mod github;
pub mod projects;
pub mod run;
pub mod settings;
