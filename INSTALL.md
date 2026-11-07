# Instalación en Samsung TV

## Preparación

1. Instalar las herramientas web de Tizen, Samsung TV Extension y Samsung
   Certificate Extension. El proyecto declara `tv-samsung` y API mínima 3.0.
2. En el TV, abrir Apps, introducir `12345`, activar Developer Mode e indicar
   la IP de la PC. Reiniciar el TV si se acaba de activar este modo.
3. Conectar PC y TV a la misma red. Crear un perfil de certificados Samsung TV
   cuyo certificado de distribuidor incluya el DUID del dispositivo.
4. En Device Manager, conectar el TV y usar **Permit to install applications**
   si lo requiere el certificado.

## Compilar y firmar

```sh
npm ci
npm run build
```

Con el CLI moderno `tz`, desde PowerShell:

```powershell
.\tools\package-tv.ps1 -TzPath 'RUTA_AL_SDK\tools\tizen-core\tz.exe' -SigningProfile 'MI_PERFIL'
```

Genera `artifacts\ManicMinerTizen.wgt`. Utiliza exclusivamente los certificados
locales del perfil elegido. No incluir certificados, contraseñas ni WGT firmados
en Git. En VS Code también se puede abrir `tizen/`, seleccionar el perfil de
certificados y usar las acciones Build y Package de la extensión Tizen.

Con el CLI clásico de Tizen Studio:

```sh
tizen build-web -- tizen
tizen package -t wgt -s MI_PERFIL -- tizen/.buildResult
```

Usar el archivo WGT que indique la salida del empaquetador.

## Instalar y ejecutar

Las herramientas `sdb` y `tz` deben estar en PATH o invocarse por ruta completa.
Reemplazar `IP_DEL_TV` por la dirección del televisor.

```sh
sdb connect IP_DEL_TV:26101
sdb devices
tz install -e IP_DEL_TV:26101 -p artifacts/ManicMinerTizen.wgt
sdb -s IP_DEL_TV:26101 shell 0 was_execute MinerTV001.ManicMiner
```

El identificador de aplicación es `MinerTV001.ManicMiner`; el paquete es
`MinerTV001`. En televisores antiguos, `tz run` puede intentar usar `execute` y
fallar con `closed`; `was_execute` es el comando para la aplicación web.

Si falla la firma, revisar DUID, perfil, permiso de instalación y fecha del TV.
Si falla la conexión, revisar Developer Mode, IP de la PC, red y firewall.
El widget es independiente del servidor de previsualización y no requiere
actualizar el firmware del TV.

Referencias: [certificados Samsung](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html),
[CLI](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html),
[mando](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html).
