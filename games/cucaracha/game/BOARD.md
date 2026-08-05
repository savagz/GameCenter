## Diseño del tablero del jugador

El tablero representa una **cucaracha vista de frente**, con el cuerpo centrado y las patas abiertas de forma simétrica.

Las **24 posiciones** del tablero son círculos distribuidos sobre las diferentes partes del cuerpo. Cada círculo muestra el valor que debe completarse (**1**, **2** o **3**).

### Distribución

#### Antenas (4 posiciones)

Cada antena posee dos posiciones de valor **2**.

- Antena izquierda: 2 posiciones (valor 2)
- Antena derecha: 2 posiciones (valor 2)

Total: **4 posiciones de valor 2**

---

#### Cabeza (3 posiciones)

Sobre la cabeza existen tres posiciones de valor **2**.

- Centro superior de la cabeza
- Lado izquierdo del rostro
- Lado derecho del rostro

Total: **3 posiciones de valor 2**

---

#### Patas delanteras (4 posiciones)

Las dos patas superiores contienen una articulación amarilla.

Cada pata tiene:

- 1 posición de valor **1** en la articulación.

Total: **4 posiciones de valor 1**

---

#### Brazos (4 posiciones)

Los brazos intermedios son de color naranja.

Cada brazo tiene:

- 1 posición de valor **1** cerca del hombro.

Total: **4 posiciones de valor 1**

---

#### Patas medias (4 posiciones)

Las patas inferiores del torso tienen una articulación amarilla.

Cada una posee:

- 1 posición de valor **1** junto al cuerpo.
- 1 posición de valor **1** en la articulación.

Total: **4 posiciones de valor 1**

---

#### Abdomen (5 posiciones)

El abdomen contiene posiciones alineadas verticalmente.

Distribución:

- 2 posiciones laterales superiores (valor 1)
- 2 posiciones laterales inferiores (valor 1)
- 1 posición inferior central (valor 1)

Total: **5 posiciones de valor 1**

---

#### Cola (1 posición)

En el extremo inferior del cuerpo existe una única posición.

- Valor **3**

Total: **1 posición de valor 3**

---

## Resumen

| Valor | Cantidad |
|--------|---------:|
| 1 | 16 |
| 2 | 7 |
| 3 | 1 |
| **Total** | **24** |

---

## Requisitos de diseño

- El tablero debe tener apariencia de un juguete infantil.
- Fondo de madera clara con marco naranja.
- La cucaracha debe ser caricaturesca y amigable.
- El cuerpo debe ser simétrico.
- Cada posición será un círculo gris claro con borde oscuro.
- Dentro del círculo se mostrará el número correspondiente (1, 2 o 3).
- Las posiciones deben estar distribuidas exactamente sobre las extremidades y el cuerpo, nunca flotando fuera de la figura.
- Cada posición debe poder cambiar de estado (vacía, ocupada, resaltada o completada).
- Al completarse una posición debe cambiar de color con una animación suave.
- Todo el tablero debe escalar correctamente para dispositivos móviles y escritorio.