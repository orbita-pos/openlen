# Where each chart is drawn

## A page

Chart.js 4.5.0, the chart library that survives publishing (bar, line, pie, radar on a `<canvas>`, global `Chart`). Its exact `<script>` tag is in the `frontend-design` skill, in references/libraries.md: copy it as written there. Give the canvas a parent with a set height and `maintainAspectRatio: false`, and set the chart's font, text color and gridline color to the page's (`Chart.defaults.font.family`, `Chart.defaults.color`, `Chart.defaults.borderColor`). Look at it with `view_page` and a screenshot.

## An app

recharts 2 from the app's catalog (`ResponsiveContainer`, `BarChart`, `LineChart`, `AreaChart`, `PieChart`, `XAxis`, `YAxis`, `Tooltip`), which shadcn's Chart component is built on. `npm install recharts` in the terminal says whether the app's catalog has it; an app on an older catalog draws its charts as SVG in a component. Look at the screen with `view_page` and its `screen`.

## A dashboard deliverable

Load `artifact-dashboard`, when it is in the skill list, and follow it: d3 v7 is the global `d3`, Recharts works as an import, and every chart reads its dataset.

## An Excel workbook

Load `office-xlsx`. Native charts with `openpyxl.chart` (`BarChart`, `LineChart`, `PieChart`, `Reference`), so they stay editable and follow their cells. Each series' color goes in its `graphicalProperties` (`solidFill` for bars, `line.solidFill` for lines), as hex without `#`. Render it with `office-render` and look.

## A PDF

Load `pdf`. Charts with reportlab's `reportlab.graphics.charts` (`VerticalBarChart`, `HorizontalLineChart`, `Pie`) inside a `Drawing`, which goes into the document like any flowable. Colors with `colors.HexColor("#0072b2")`, and the registered TrueType font on the axis labels (`categoryAxis.labels.fontName`, `valueAxis.labels.fontName`). The terminal has no matplotlib. Look at it with `Read` and `pages`.

## A PowerPoint deck

Load `office-pptx`. A native chart with python-pptx (`CategoryChartData` and `slide.shapes.add_chart`), so it stays editable in PowerPoint.
