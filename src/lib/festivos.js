// Calcula los festivos colombianos de cualquier año, sin lista fija —
// usando el algoritmo de Gauss para la Pascua, más la Ley Emiliani (traslado a lunes).
function pascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia);
}
function sumarDias(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function siguienteLunes(d) {
  const x = new Date(d);
  while (x.getDay() !== 1) x.setDate(x.getDate() + 1);
  return x;
}
function comoStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let cacheFestivos = {};
export function festivosDelAnio(anio) {
  if (cacheFestivos[anio]) return cacheFestivos[anio];
  const p = pascua(anio);
  const fijos = [[0, 1], [4, 1], [6, 20], [7, 7], [11, 8], [11, 25]].map(([m, d]) => new Date(anio, m, d));
  const emiliani = [[0, 6], [2, 19], [5, 29], [7, 15], [9, 12], [10, 1], [10, 11]].map(([m, d]) =>
    siguienteLunes(new Date(anio, m, d))
  );
  const pascuaFijos = [sumarDias(p, -3), sumarDias(p, -2)];
  const pascuaLunes = [43, 64, 71].map((n) => siguienteLunes(sumarDias(p, n)));
  const todos = new Set([...fijos, ...emiliani, ...pascuaFijos, ...pascuaLunes].map(comoStr));
  cacheFestivos[anio] = todos;
  return todos;
}

export function esFestivo(fechaStr) {
  const anio = parseInt(fechaStr.slice(0, 4));
  return festivosDelAnio(anio).has(fechaStr);
}

// Lunes de la semana a la que pertenece una fecha (o el lunes siguiente si cae en festivo,
// ya que ese día no trabaja la administradora).
export function primerDiaHabilDeLaSemana(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00');
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  let candidato = lunes;
  while (esFestivo(comoStr(candidato))) {
    candidato = sumarDias(candidato, 1);
  }
  return comoStr(candidato);
}

export function semanaDe(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00');
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return comoStr(lunes);
}
