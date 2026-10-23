import { dic, type Lang } from "@/i18n";
import resultados from "@/data/resultados-modelo.json";

// One dated source for both languages and both placements. These are model
// evaluations published by its developer, not measurements of Len's full loop.
export function ResultadosModelo({ lang }: { lang: Lang }) {
  const d = dic(lang).portada.rendimiento;
  const number = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <figure className="model-results">
      <table>
        <caption>{d.caption}</caption>
        <thead><tr>{d.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
        <tbody>{resultados.rows.map((row, index) => (
          <tr key={row.benchmark}>
            <th scope="row">{d.metrics[index]}<small>{row.benchmark === "HLE" ? d.hle : row.benchmark}</small></th>
            <td>{number.format(row.previous)}</td>
            <td><strong>{number.format(row.current)}</strong></td>
          </tr>
        ))}</tbody>
      </table>
      <figcaption>
        <p>{d.note}</p>
        <p>{d.method}</p>
        <a href={resultados.source}>{d.source}</a>
      </figcaption>
    </figure>
  );
}
