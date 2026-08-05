# GameCenter — Especificación General

## 1. Objetivo

Crear la infraestructura y arquitectura principal de **GameCenter**, una plataforma que centralice los diferentes juegos disponibles y permita al jugador configurar una partida y, opcionalmente, habilitar un sistema de apuestas.

---

# 2. Página Inicial — GameCenter

La pantalla inicial será el punto de entrada a la plataforma.

Debe presentar una interfaz visual tipo **lobby de juegos premium**, desde la cual el jugador pueda seleccionar el juego al que desea ingresar.

### Elementos principales

#### Esquina superior izquierda

**Jugador**

Botón o área interactiva para ingresar el nombre del jugador.

#### Esquina superior derecha

**Configuración**

Botón para acceder a las configuraciones generales de GameCenter.

---

# 3. Selección de Juego

La pantalla principal debe mostrar los juegos disponibles mediante tarjetas o paneles visuales.

### Juegos disponibles

1. **Cucaracha II**
2. **Rummy**
3. **¿Por qué siempre yo?**
4. **Bendito 7**

Cada juego debe tener:

* Nombre.
* Imagen o representación visual.
* Botón **ENTRAR / JUGAR**.
* Indicador visual cuando el juego está seleccionado (Efecto con mouseover).
* Acceso a la configuración de la partida antes de iniciar.

La navegación debe permitir seleccionar fácilmente cualquiera de los juegos.

---

# 4. Configuración de la Partida

Antes de iniciar una partida, GameCenter debe permitir configurar los parámetros generales.

## 4.1 Sistema de apuestas

Agregar una opción:

### Activar apuestas

Control tipo **ON / OFF**.

Por defecto puede permanecer desactivado.

### Si las apuestas están desactivadas

La partida se desarrolla normalmente sin utilizar dinero o capital de juego.

### Si las apuestas están activadas

Mostrar las siguientes opciones:

#### Monto de apuesta / CASE

Define el monto que cada jugador debe colocar para participar en la partida.

**Monto de apuesta:** `$ ______`

#### Monto de jugada de castigo

Define el monto utilizado para las penalizaciones cuando las reglas del juego contemplen una jugada de castigo.

**Jugada de castigo:** `$ ______`

> Los valores configurados en GameCenter deben estar disponibles para el juego correspondiente sin modificar directamente la lógica original del juego.

---

# 5. Aplicación de las Apuestas por Juego

La configuración de apuestas debe integrarse de forma uniforme, pero respetando las reglas específicas de cada juego.

## 5.1 Bendito 7

Si las apuestas están activadas:

* Utiliza el **Monto de apuesta / CASE**.
* Utiliza el **Monto de jugada de castigo**.

### Regla especial

Una vez que el jugador haya completado todos los números de su tablero, debe realizar un lanzamiento adicional buscando obtener **7** para ganar.

Si obtiene **7 antes de completar el tablero**, se aplica la **jugada de castigo** correspondiente.

---

## 5.2 Rummy

Si las apuestas están activadas:

* Utiliza el **Monto de apuesta / CASE**.

No se requiere una jugada de castigo adicional desde GameCenter.

---

## 5.3 ¿Por qué siempre yo?

Si las apuestas están activadas:

* Utiliza el **Monto de apuesta / CASE**.

---

## 5.4 Cucaracha II

Si las apuestas están activadas:

* Utiliza el **Monto de apuesta / CASE**.
* Utiliza la **Jugada de castigo** definida específicamente por las reglas de Cucaracha II.

La lógica de castigo debe continuar siendo responsabilidad del juego.

---

# 6. Inicio de una Partida con Apuestas

Cuando el sistema esté configurado con **Apuestas = ON**, antes de comenzar la partida debe aparecer una confirmación para todos los jugadores.

### Mensaje

**APUESTA DE LA PARTIDA**

> Apuesta: `$500`
> Jugada de castigo: `$100`

Cada jugador debe confirmar:

**[ OK — COLOCAR APUESTA ]**

**[ CANCELAR ]**

### Si el jugador selecciona OK

Se registra su participación y se continúa con el inicio de la partida.

### Si el jugador selecciona CANCELAR

El jugador abandona la partida y sale de la sala.

El sistema debe evitar que la partida comience hasta que todos los jugadores requeridos hayan confirmado su apuesta.

---

# 7. Mensajes Unificados de GameCenter

Todos los juegos deben utilizar un sistema visual y funcional común para determinados eventos.

La implementación debe ser centralizada en **GameCenter**, evitando crear diferentes versiones de estos componentes para cada juego.

---

## 7.1 Cambio de Turno

Agregar un mensaje visual cada vez que cambie el turno.

Debe utilizar un diseño similar al actualmente definido para **Cucaracha**.

Ejemplo:

> ### TURNO DE
>
> **SAMUEL**
>
> Es tu turno de jugar.

El mensaje debe aparecer de manera destacada y desaparecer automáticamente después de un breve intervalo o cuando el jugador realice la acción correspondiente.

Debe funcionar de la misma manera en:

* Cucaracha II
* Rummy
* ¿Por qué siempre yo?
* Bendito 7

---

# 8. Mensaje de Victoria

Cuando un jugador gane una partida, mostrar un mensaje destacado indicando:

* Nombre del ganador.
* Resultado.
* Monto ganado, si las apuestas están activadas.

### Ejemplo sin apuestas

> 🏆 **¡SAMUEL GANÓ!**
>
> ¡Felicitaciones!

### Ejemplo con apuestas

> 🏆 **¡SAMUEL GANÓ!**
>
> **Ganancia: $2.500**

El mensaje debe mantener un estilo visual consistente con el mensaje de cambio de turno.

---

# 9. Sistema de Premios y Ganancias

Cuando las apuestas estén activadas, GameCenter debe administrar la información económica de la partida.

Debe ser posible determinar:

* Monto de apuesta de cada jugador.
* Total acumulado de la partida.
* Penalizaciones aplicadas.
* Ganador.
* Monto ganado por el ganador.

El cálculo final debe respetar las reglas particulares de cada juego.

> GameCenter debe proporcionar la infraestructura común para manejar estos valores, mientras que cada juego determina cuándo corresponde aplicar una apuesta, penalización o premio.

---

# 10. Ajuste Específico de Cucaracha II

Modificar la integración de **Cucaracha II** para eliminar el concepto de **capital inicial**.

### Antes

La partida utilizaba un capital inicial para los jugadores.

### Nuevo comportamiento

**No utilizar capital inicial.**

El sistema debe trabajar exclusivamente con:

* Monto de apuesta / CASE.
* Jugadas de castigo definidas por el juego.
* Ganancias y pérdidas generadas durante la partida.

La eliminación del capital inicial debe realizarse mediante la integración de GameCenter sin alterar innecesariamente la versión existente de Cucaracha II.

---
# 11. Objetivo Final

El resultado debe ser una plataforma **GameCenter** desde la cual el usuario pueda:

1. ingresar nombre de jugador.
2. Seleccionar uno de los cuatro juegos.
3. Crear o ingresar a una sala.
4. -
5. Activar o desactivar apuestas.
6. Definir el monto de apuesta / CASE.
7. Definir el monto de jugada de castigo cuando corresponda.
8. Confirmar la apuesta antes de comenzar.
9. Jugar utilizando las reglas específicas de cada juego.
10. Recibir mensajes unificados de cambio de turno.
11. Recibir un mensaje de victoria.
12. Visualizar cuánto ganó el ganador cuando existan apuestas.

**GameCenter debe convertirse en la capa común de navegación, configuración, salas, apuestas, jugadores, turnos y eventos compartidos, mientras cada juego mantiene su propia lógica y reglas.**

En la carpeta games esta la veersionn independiente de cada juego, ajusta para que su funcionamiento este funcioanl a un soloo proyecto
