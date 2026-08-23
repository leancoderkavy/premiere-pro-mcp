# Inicio rápido de Premiere MCP

Esta es una traducción asistida por máquina del origen en
[inglés](en.md); agradecemos la revisión de la comunidad. Úsela junto con el
[README](../../README.md), que contiene los enlaces de descarga y versiones
compatibles actuales.

<!-- quickstart:section=before-you-start -->
## Antes de empezar

Use una copia de un proyecto de prueba, nunca trabajo activo de un cliente. El
servidor MCP local, el conector de Premiere y el cliente de IA deben ejecutarse
en el mismo equipo. Empiece con una comprobación de conexión de solo lectura:
la instalación y el estado verde del panel no demuestran que una edición haya
funcionado en un host de Premiere con licencia.

<!-- quickstart:section=install -->
## Instale el servidor y el conector

Para Claude Desktop, instale el paquete `.mcpb` actual y el conector firmado
separado de Premiere desde la versión actual de GitHub. Reinicie ambas
aplicaciones.

Para otro cliente MCP, instale el servidor y después el conector CEP:

```bash
npm install -g premiere-pro-mcp
premiere-pro-mcp --install-cep
```

Configure el cliente para ejecutar `premiere-pro-mcp`. El README completo
incluye ejemplos JSON específicos por cliente.

<!-- quickstart:section=prove-connection -->
## Compruebe la conexión sin riesgos

1. Abra Premiere, abra el proyecto de prueba copiado y abra una secuencia
   activa.
2. En Premiere, elija **Window > Extensions > MCP for Adobe Premiere Pro**.
   “Running” significa que el puente del panel está disponible; no demuestra
   que se haya completado una edición.
3. Ejecute la comprobación local:

   ```bash
   premiere-pro-mcp --doctor
   ```

4. Pida al cliente de IA: `Run verify_premiere_connection. Make no changes.`

El doctor local informa del descubrimiento del paquete y de la configuración.
La respuesta MCP informa del puente seleccionado y de la disponibilidad del
proyecto y la secuencia sin devolver detalles del proyecto. Considere un fallo
o una secuencia ausente como un resultado de configuración que debe corregirse,
no como permiso para repetir una mutación.

<!-- quickstart:section=first-edit -->
## Realice la primera edición con cuidado

Tras superar la comprobación de solo lectura, pida un plan limitado para la
secuencia de prueba copiada. Revise el destino, los cambios y el límite de
confirmación antes de permitir una edición. Después vuelva a inspeccionar la
secuencia y use Deshacer para comprobar que el fixture vuelve a su estado
anterior.

<!-- quickstart:section=remove -->
## Elimine el conector

Cierre Premiere por completo y después elimine solamente este conector CEP:

```bash
premiere-pro-mcp --uninstall-cep
```

Esto deja sin cambios la configuración compartida de depuración de Adobe para
no interrumpir otras extensiones CEP. Elimine también el servidor MCP de la
configuración del cliente de IA y desinstale el paquete npm por separado si ya
no lo utiliza.
