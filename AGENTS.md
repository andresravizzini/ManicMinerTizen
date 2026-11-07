# Desarrollo

- `ManicMiner.asm` y `ManicMiner.bin` son recursos originales: conservarlos intactos.
- Adaptar presentación y entrada en `tizen/`; mantener nombres, colores y reglas originales.
- Runtime compatible con Tizen 3.0: ES5, sin WebAssembly, módulos ES ni AudioWorklet.
- `npm run build` genera el emulador estático y valida la sintaxis ES5.
- Validar con `npm test` y `npm run test:browser`; este último requiere Chrome.
- `tizen/config.xml` y `tizen/tizen_web_project.yaml` declaran Samsung TV y API 3.0.
- La firma usa un perfil local del usuario; seguir `INSTALL.md`.
- Publicar solo código y recursos: excluir claves, certificados, WGT firmados,
  direcciones IP, rutas personales, credenciales y registros del dispositivo.
- Mantener README, instalación y atribuciones breves, sin bitácoras de trabajo.
