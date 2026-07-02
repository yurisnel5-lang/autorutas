# AutoRutas

Aplicación web que **importa automáticamente las facturas del día desde QuickBooks Online**, las clasifica en dos zonas de reparto (**Norte** y **Sur**), calcula el **orden óptimo de las paradas** con Google Maps, las **asigna automáticamente** al chofer predeterminado de cada zona, y permite al administrador **ver en tiempo real la ubicación de los choferes** en un mapa — algo similar en concepto a Detrack, pero hecho a la medida y conectado directamente a QuickBooks.

Está diseñada para **adaptarse a cualquier compañía de entregas y a cualquier ciudad**, no solo a Miami: todo se configura desde el panel web (formularios), sin tocar código.

Una vez configurados los parámetros necesarios (ver más abajo), **todo el proceso corre solo, todos los días**, sin intervención manual.

## ¿Qué incluye?

- Importación automática diaria de facturas desde QuickBooks Online mediante OAuth2, con formulario en el panel.
- - Modo demo con facturas de ejemplo.
  - - Clasificación automática en zona Norte / Sur.
    - - Optimización del orden de las paradas con Google Maps.
      - - Gestión de choferes con zona predeterminada.
        - - Página móvil para cada chofer con ubicación GPS en vivo.
          - - Mapa en vivo para el administrador.
            - - Panel de administración con interfaz cuidada.
             
              - Ver los archivos server/ y public/ para el código completo. Configura todo desde el panel en /admin.
              - 
