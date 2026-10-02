// lib/agent/terminal/codigo-de-salida.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { esFalloDeLaTerminal } from "./codigo-de-salida";

describe("esFalloDeLaTerminal — la regla de Claude Code para el código de salida", () => {
  it("0 nunca es fallo; del 2 en adelante, siempre", () => {
    expect(esFalloDeLaTerminal("sed -i 's/a/b/' /index.html", 0)).toBe(false);
    expect(esFalloDeLaTerminal("grep -r x /", 2)).toBe(true);
    expect(esFalloDeLaTerminal("grep -c x /index.html", 126)).toBe(true);
  });

  it("con 1, grep, rg, find, diff, test y [ contestan; lo demás falla", () => {
    for (const c of ["grep -c zzz /index.html", "egrep x /a", "fgrep x /a", "rg x /", "find / -name x", "diff /a /b", "test -f /x", "[ -f /x ]"]) {
      expect(esFalloDeLaTerminal(c, 1), c).toBe(false);
    }
    for (const c of ["sed -i 's/a/b/' /x", "cat /no-existe", "jq .x /datos/a.json", "[[ -f /x ]]", "/bin/grep x /a", "LC_ALL=C grep x /a"]) {
      expect(esFalloDeLaTerminal(c, 1), c).toBe(true);
    }
  });

  it("cuenta el ÚLTIMO comando, también al final de una tubería", () => {
    expect(esFalloDeLaTerminal("cat /index.html | grep -i horario", 1)).toBe(false);
    expect(esFalloDeLaTerminal("sed -n 1p /a; grep x /a", 1)).toBe(false);
    expect(esFalloDeLaTerminal("grep x /a; sed -n 1p /b", 1)).toBe(true);
    expect(esFalloDeLaTerminal("grep x /a | wc -l", 1)).toBe(true);
    expect(esFalloDeLaTerminal("test -f /a || grep x /b", 1)).toBe(false);
    expect(esFalloDeLaTerminal("grep x /a;\n", 1)).toBe(false);
  });

  it("detrás de && no se sabe de quién es el 1: fallo", () => {
    expect(esFalloDeLaTerminal("cd /menu && grep x index.html", 1)).toBe(true);
    expect(esFalloDeLaTerminal("cd /menu && cat index.html | grep x", 1)).toBe(true);
    expect(esFalloDeLaTerminal("cd /menu &&\n  grep x index.html", 1)).toBe(true);
    expect(esFalloDeLaTerminal("cd /menu && sed -n 1p a; grep x index.html", 1)).toBe(false);
  });

  it("los separadores dentro de comillas, $(…) y comentarios no parten la línea", () => {
    expect(esFalloDeLaTerminal('grep "a; b && c" /index.html', 1)).toBe(false);
    expect(esFalloDeLaTerminal("grep 'x | y' /index.html", 1)).toBe(false);
    expect(esFalloDeLaTerminal('jq -r "$(grep "x; y" /a)" /b', 1)).toBe(true);
    expect(esFalloDeLaTerminal("grep -l Ana $(ls /bandeja && echo /index.html)", 1)).toBe(false);
    expect(esFalloDeLaTerminal("grep x /a # it's the menu", 1)).toBe(false);
    expect(esFalloDeLaTerminal("grep x /a 2>&1", 1)).toBe(false);
    expect(esFalloDeLaTerminal("grep x /a &>/dev/null", 1)).toBe(false);
    expect(esFalloDeLaTerminal("cat /a |\n  grep x", 1)).toBe(false);
  });

  it("lo que no se sabe leer es fallo: equivocarse hacia el rojo, nunca hacia el verde", () => {
    expect(esFalloDeLaTerminal('grep "x /a', 1)).toBe(true);
    expect(esFalloDeLaTerminal("case $a in x) grep y /a;; esac", 1)).toBe(true);
    expect(esFalloDeLaTerminal("", 1)).toBe(true);
  });
});
