Estoy en un club de barrio, Club Atletico Deportivo Barreal, de Barreal San Juan.

## Objetivo

Somos un club chico movido por los hinchas. Los domingos que jugamos en nuestra cancha de local, tenemos la cantina y vendemos cosas.
Hoy en dia llevamos el control de stock y ventas mediante lapiz y papel.

Quiero crear un sistema para modernizar esto.

## Alcance

El sistema debe ser de inventario y ventas. Debe poder:
- cargar productos nuevos
- configurar precios
- ingresar stock de productos
- anotar ventas
- generar balance (diario, semanal, mensual, etc)

## Usuarios y Roles

Solo usuarios autenticados pueden ingresar al sistema. El sistema NO debe permitir crear usuarios desde la pagina web.
Los usuarios se crean desde el panel administrador (seccion siguiente).

A continuacion se listan los roles disponibles con las acciones que pueden hacer

### Venta
- ingresar stock de productos
- anotar ventas

### Admin

Pueden hacer todo lo de ventas, mas:

- cargar productos nuevos
- generar balance
- crear usuarios y asignarle roles

El sistema web debe tener un subdominio de administrador que se accede con usuario y contrasena.

El admin pueden ingresar con las mismas credenciales en la pagina de ventas como en el panel de admin.

Un administrador no puede quitarle el rol de administrador a otro.

### Owner

Es el rol maximo.

Es lo mismo que admin solo que puede quitar rol de admin a otros usuarios.

# Diseno tecnico

Es una web interna por lo que no tiene que ser muy fancy. Se debe enfocar en la facilidad de uso y ser sencilla.

Ademas, el stack debe ser lo mas barato posible, incluso si es gratis mejor.

Stack (para terminar de definir):
- Framework: Vue
- CSS: Algun framework light
- Host: Quiero que sea una web static que se pueda servir con un CDN+Storage (por ejemplo CloudFront+S3. Acepto otras soluciones.)
- Server: Algo como firebase que se pueda acceder directamente desde la web y permita manejar usuarios y roles.

Todo el stack definido es para terminar de definir.

## Estrucutra del projecto

Monorepo con `/src/client`, `/src/server` y `/src/shared/` en caso de necesitarse.

Estructura simple Presentacion/Dominio/Infraestructura.

Todos los detalles de implementacion deben estar bajo interfaces de dominio y ser reemplazables sin afectar el dominio.

La estructura de carpetas debe ser simple. Tratemos de evitar tener muchas carpetas dentro de cada subdominio.

Quiero algo parecido a:

```
- src/
   - inventory/
       - web/
       - domain/
       - infra/
```

Tener un `package.json` unico o, a lo sumo, uno para server y otro para client.

Enfasis en que debe ser simple. Es un proyecto chico sin mucha escala para un club de barrio.
Va a ser usado por pocas personas.