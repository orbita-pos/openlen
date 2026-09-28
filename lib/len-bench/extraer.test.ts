// lib/len-bench/extraer.test.ts
import { describe, expect, it } from "vitest";
import {
  aparece,
  cantidadesDeLaPagina,
  cifrasDe,
  correosDe,
  esElTelefonoDado,
  numerosDeContacto,
  numerosDe,
  numerosDeWhatsApp,
  preciosDe,
  telefonosDe,
  textoVisible,
} from "./extraer";

describe("textoVisible", () => {
  it("quita scripts, estilos y etiquetas; los bloques quedan en líneas distintas", () => {
    expect(textoVisible("<style>a{}</style><h1>Hola</h1><script>x=1</script><p>mundo</p>")).toBe("Hola\nmundo");
  });
  it("dentro de un bloque, las etiquetas en línea separan con un espacio", () => {
    expect(textoVisible("<p>Taco al <b>pastor</b> y <a href='#'>más</a></p>")).toBe("Taco al pastor y más");
  });
});

describe("teléfonos", () => {
  it("los reconoce con separadores y los compara en dígitos", () => {
    expect(telefonosDe("Llámanos al (33) 1234-5678 o al 33 8765 4321")).toEqual(["3312345678", "3387654321"]);
  });
  it("un teléfono no se pega a las cifras del elemento de al lado (plantilla voltio: «33 1907 4482</a> <div>24/7»)", () => {
    const html = '<a href="#">33 1907 4482</a>\n<div class="mono">24/7 · urgencia nocturna +$300</div>';
    expect(telefonosDe(textoVisible(html))).toEqual(["3319074482"]);
    expect(preciosDe(textoVisible(html))).toEqual(["300"]);
  });
  it("no confunde un año o un precio con un teléfono", () => {
    expect(telefonosDe("Desde 2019, tacos a $25")).toEqual([]);
  });
  it("saca los números de tel:, wa.me y api.whatsapp.com", () => {
    const html = '<a href="tel:+523312345678">x</a><a href="https://wa.me/5213312345678">y</a><a href="https://api.whatsapp.com/send?phone=523312345678">z</a>';
    expect(numerosDeContacto(html)).toEqual(["523312345678", "5213312345678", "523312345678"]);
  });
  it("QUITAR la lada de país que sí dieron no es inventar: +52 33 1234 5678 se puede escribir (33) 1234-5678", () => {
    expect(esElTelefonoDado("3312345678", "523312345678")).toBe(true);
    expect(esElTelefonoDado("3312345678", "5213312345678")).toBe(true);
  });
  it("PONER una lada que nadie dio sí lo es (lada-que-nadie-dio), y el 1 de móvil viejo de México también", () => {
    expect(esElTelefonoDado("523312345678", "3312345678")).toBe(false);
    expect(esElTelefonoDado("5213312345678", "523312345678")).toBe(false);
  });
  it("quitar también la lada de ciudad deja un número que ya no es el dado", () => {
    expect(esElTelefonoDado("12345678", "523312345678")).toBe(false);
  });
  it("de WhatsApp sólo cuentan los enlaces de WhatsApp: un tel: es una llamada, no un chat", () => {
    const html =
      '<a href="tel:+523312345678">x</a><a href="https://wa.me/523312345678?text=hola">y</a>' +
      '<a href="https://api.whatsapp.com/send?phone=5213312345678">z</a>' +
      "<script>open('whatsapp://send?text=hola&phone=523399990000')</script>";
    expect(numerosDeWhatsApp(html)).toEqual(["523312345678", "5213312345678", "523399990000"]);
    expect(numerosDeWhatsApp('<a href="tel:+523312345678">Llámanos</a>')).toEqual([]);
  });
});

describe("correos y precios", () => {
  it("correos en minúsculas", () => {
    expect(correosDe("Escríbenos a Hola@Taqueria.MX")).toEqual(["hola@taqueria.mx"]);
  });
  it("precios con $ y con moneda detrás, en dígitos, y $70.00 es el mismo precio que $70", () => {
    // Si «.00» contara, Len escribiendo $70.00 donde la ficha dice $70 saldría
    // acusado de inventar un precio que no inventó.
    expect(preciosDe("Taco $25 · Gringa $ 70.00 · Agua 30 MXN · Paquete $1,250.50")).toEqual(["25", "70", "30", "125050"]);
  });
  it("también en euros (las partidas de España): pegados, con espacio, delante o como EUR", () => {
    expect(preciosDe("Esencial 19€ /mes · Villa 1.850.000 € · Suelta 14 EUR · Taller €9")).toEqual(["19", "1850000", "14", "9"]);
  });
  it("un precio en euros de la ficha aparece aunque cambie el espacio", () => {
    expect(aparece("1.790.000 €", "<span>1.790.000€</span>")).toBe(true);
    expect(aparece("1.790.000 €", "<span>1.850.000 €</span>")).toBe(false);
  });
});

describe("cifras del negocio", () => {
  it("años, cantidades, notas y porcentajes (la página de la agencia de viajes, prod 19–21/09)", () => {
    expect(cifrasDe("Desde 2019 · 4.800 viajeros · 4,9 en 1.240 reseñas · 98 % repite")).toEqual(["2019", "4800", "4.9", "1240", "98"]);
  });
  it("la misma cifra con punto o con coma es la misma", () => {
    expect(cifrasDe("4,9 · 1,240 · 10.000")).toEqual(cifrasDe("4.9 · 1.240 · 10000"));
  });
  it("teléfonos, precios y horas no son cifras: son de nada-inventado", () => {
    expect(cifrasDe("Llámanos al (33) 1234-5678 · Taco $25 · Agua 30 MXN · de 20:00 a 02:00")).toEqual([]);
    expect(cifrasDe("Desde 450.000 € · Esencial 19€ /mes")).toEqual([]);
  });
  it("un dígito suelto no es una cifra del negocio («Paso 1», «3 tacos»)", () => {
    expect(cifrasDe("Paso 1 · 3 tacos por orden")).toEqual([]);
  });
  it("numerosDe los coge TODOS, también los de teléfonos, precios y horas: es lo DADO", () => {
    expect(numerosDe("Tel 33 1234 5678 · $25 · 8:00")).toEqual(["33", "1234", "5678", "25", "8", "0"]);
  });
});

describe("aparece", () => {
  it("un teléfono aparece aunque cambie el formato", () => {
    expect(aparece("33 1234 5678", "<p>Tel: (33) 1234-5678</p>")).toBe(true);
  });
  it("el teléfono de la ficha con lada de país aparece si la página lo escribe sin ella", () => {
    expect(aparece("+52 33 1234 5678", "<p>Pide al (33) 1234-5678</p>")).toBe(true);
  });
  it("un texto aparece sin importar mayúsculas ni espacios repetidos", () => {
    expect(aparece("Taco al pastor", "<li>TACO   al Pastor</li>")).toBe(true);
  });
  it("un precio aparece como PRECIO: $25 está en «$ 25.00» y en «25 pesos», y no en «$250»", () => {
    expect(aparece("$25", "<li>Taco — $ 25.00</li>")).toBe(true);
    expect(aparece("$25", "<li>Taco, 25 pesos</li>")).toBe(true);
    expect(aparece("$25", "<li>Paquete familiar $250</li>")).toBe(false);
  });
  it("lo que no está, no aparece", () => {
    expect(aparece("Gringa", "<li>Taco</li>")).toBe(false);
  });
});

describe("cantidadesDeLaPagina", () => {
  it("lee el value de los campos numéricos (number y range), con punto o coma; ni texto ni vacíos", () => {
    const html =
      '<input id="m" type="number" min="0.5" value="2"><input type="range" value="2,5" min="1">' +
      '<input type="text" value="7"><input type="number"><input value="9" type=\'number\'>';
    expect(cantidadesDeLaPagina(html)).toEqual([2, 2.5, 9]);
  });
});
