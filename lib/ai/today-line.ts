/**
 * Qué día es hoy, para cualquier prompt que escriba texto en la página.
 *
 * Un modelo no sabe la fecha y cuenta desde su entrenamiento. Medido dos veces
 * en dos superficies distintas: el Agente escribió una cuenta regresiva DOS
 * MESES vencida, y la puerta de generar convirtió "desde 1998" en "26 años de
 * oficio" — la cuenta desde 2024.
 *
 * Vive en un solo sitio a propósito. Arreglado por superficie, cada puerta
 * nueva nace ciega otra vez: cuando esto se escribió había siete que redactan
 * copy del usuario y sólo dos sabían la fecha.
 */
export function todayLine(now: Date = new Date()): string {
  return `HOY ES ${now.toISOString().slice(0, 10)}. Cualquier cifra o fecha que escribas —años de experiencia, "desde 1998", el año del copyright, cuentas regresivas, temporadas— se calcula contra hoy, no contra ninguna otra época.\n\n`;
}
