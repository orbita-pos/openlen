// lib/expr/machine.ts — la máquina de pila, como texto.
//
// Esto NO es un módulo que se importe: es la fuente del runtime que viaja
// dentro de la receta y acaba como `<script>` en la página del visitante. Vive
// como cadena por la misma razón que `lib/behaviors/recipes/*.ts`: el
// presupuesto de bytes se mide sobre lo que de verdad se envía.
//
// Se exporta también una versión ejecutable para las pruebas, de modo que el
// MISMO texto que se hornea es el que se prueba. Un runtime probado desde una
// copia paralela es un runtime sin probar.

/**
 * Un bucle y un `switch`. Sin `eval`, sin `new Function`.
 *
 * La ÚNICA recursión es la de las comprensiones (`TODOS`/`ALGUNO`/`CUENTA_SI`/
 * `FILTRA`), que llaman a `olX` con su sub-programa una vez por elemento. No es
 * recursión de USUARIO —no hay forma de escribirla en el lenguaje— y su
 * profundidad la acota `MAX_NODES`: cada nivel de anidamiento cuesta nodos en
 * la fórmula, y la fórmula tiene tope. `V.CADA` se guarda y se restaura, así
 * que una comprensión dentro de otra no le pisa el elemento a la de fuera.
 *
 * `P` programa (array plano) · `V` valores con nombre · `R` fuente de azar.
 *
 * Las coerciones son las mismas que en `lib/expr/evaluate.ts` y por eso hay una
 * prueba que exige que los dos den el mismo resultado: `n()` a número tolerando
 * lo que una persona teclea ("$1,200.50"), `t()` a texto, `f()` a booleano.
 */
export const MACHINE_JS = `function olX(P,V,R){var S=[],i=0,c,k,a,b,x,y,w,u;R=R||Math.random;
function n(v){if(typeof v=="number")return isFinite(v)?v:0;if(typeof v=="boolean")return v?1:0;if(v instanceof Array)return v.length;v=Number(String(v).replace(/[^0-9.-]/g,""));return isFinite(v)?v:0}
function t(v){return v instanceof Array?v.map(t).join(", "):typeof v=="boolean"?(v?"s\\u00ed":"no"):String(v)}
function f(v){return typeof v=="boolean"?v:typeof v=="number"?v!==0:v instanceof Array?v.length>0:v!==""}
function q(v){return v instanceof Array?v:[v]}
function e(v,w){return v instanceof Array||w instanceof Array||typeof v!=typeof w?t(v)===t(w):v===w}
function g(a){return Math.max(0,Math.min(6,(a.length>1?n(a[1]):0)|0))}
while(i<P.length){c=P[i++];
if(typeof c!="string"){S.push(c);continue}
k=c.charAt(0);x=c.slice(1);
if(k=="$"){S.push(V[x]===undefined?0:V[x]);continue}
if(k=="'"){S.push(x);continue}
if(k=="?"){if(!f(S.pop()))i+=+x;continue}
if(k=="j"){i+=+x;continue}
if(k=="b"){S.push(f(S.pop()));continue}
if(k=="N"){S.push(!f(S.pop()));continue}
if(k=="L"){S.push(S.splice(S.length-(+x)));continue}
if(k=="~"){S.push(-n(S.pop()));continue}
if(k=="@"){y=x.split(":");a=S.splice(S.length-(+y[1]));x=y[0];
if(x=="SUMA"||x=="MIN"||x=="MAX"){b=[];for(y=0;y<a.length;y++)b=b.concat(q(a[y]).map(n));S.push(x=="MIN"?Math.min.apply(0,b):x=="MAX"?Math.max.apply(0,b):b.reduce(function(u,v){return u+v},0));continue}
if(x=="LISTA"){S.push(a);continue}
if(x=="CUENTA"){S.push(a[0]instanceof Array?a[0].length:a.length);continue}
if(x=="REDONDEA"){b=Math.pow(10,g(a));S.push(Math.round(n(a[0])*b)/b);continue}
if(x=="TEXTO"){S.push(t(a[0]));continue}
if(x=="UNE"){S.push(a.map(t).join(""));continue}
if(x=="MONEDA"){b=n(a[0]).toFixed(Math.max(0,Math.min(6,(a.length>1?n(a[1]):0)|0)));S.push(b.replace(/\\B(?=(\\d{3})+(?!\\d))/g,","));continue}
if(x=="ELEMENTO"){b=q(a[0]);y=(n(a[1])|0)-1;S.push(y>=0&&y<b.length?b[y]:0);continue}
if(x=="POSICION"){b=q(a[0]);x=0;for(y=0;y<b.length;y++)if(!x&&e(b[y],a[1]))x=y+1;S.push(x);continue}
if(x=="TODOS"||x=="ALGUNO"||x=="CUENTA_SI"||x=="FILTRA"){b=q(a[0]);w=[];u=V.CADA;for(y=0;y<b.length;y++){V.CADA=b[y];if(f(olX(a[1],V,R)))w.push(b[y])}V.CADA=u;S.push(x=="FILTRA"?w:x=="CUENTA_SI"?w.length:x=="TODOS"?w.length==b.length:w.length>0);continue}
if(x=="AZAR"){if(a[0]instanceof Array&&a.length==1){b=a[0];S.push(b.length?b[Math.floor(R()*b.length)]:0);continue}
b=Math.ceil(n(a[0]));y=a.length>1?Math.floor(n(a[1])):b;S.push(y<b?b:b+Math.floor(R()*(y-b+1)));continue}
S.push(0);continue}
b=S.pop();a=S.pop();
S.push(c=="+"?n(a)+n(b):c=="-"?n(a)-n(b):c=="*"?n(a)*n(b):c=="/"?(n(b)?n(a)/n(b):0):c=="%"?(n(b)?n(a)%n(b):0):c=="="?e(a,b):c=="!="?!e(a,b):c=="<"?n(a)<n(b):c=="<="?n(a)<=n(b):c==">"?n(a)>n(b):c==">="?n(a)>=n(b):0)}
return S.pop()}`;

/** Lo que ocupa de verdad en la página, en bytes UTF-8.
 *
 *  `TextEncoder` y no `Buffer.byteLength`: `lib/behaviors/recipes/calc.ts`
 *  importa este módulo, y la cadena `registry → build.ts → preview` termina en
 *  un componente CLIENTE. Un `Buffer` evaluado a nivel de módulo entra en el
 *  bundle del navegador —el bundler no puede probar que es puro para
 *  eliminarlo— y `Buffer` no existe ahí. `TextEncoder` es estándar en los dos
 *  entornos y cuenta exactamente los mismos bytes. */
export const MACHINE_BYTES = new TextEncoder().encode(MACHINE_JS).length;
