import { getAI, getGenerativeModel, GoogleAIBackend, ThinkingLevel } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';
import { app } from './firebase';

// IA de la sección Reportes (solo Nelson), con Gemini a través de Firebase AI
// Logic, en su plan gratis. La clave de Gemini NO va en el código: la guarda
// Firebase. Lo que sí hace falta es App Check (reCAPTCHA Enterprise), que
// demuestra que la pregunta sale de la app de verdad y no de cualquiera que
// quiera gastarse el cupo gratis. La clave del sitio de reCAPTCHA es pública:
// Nelson la pega una vez en la pantalla y queda en config/general.

// Primero el modelo principal; si no responde (sin cupo, no disponible), se
// intenta con el más liviano.
const MODELOS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

const INSTRUCCIONES = `Eres el asesor de negocio de Nelson, dueño de Eve Jeans, una tienda de ropa para dama en Colombia.
Te llega un resumen en JSON con los números de un período de su tienda y del período anterior con el que se compara.
Cómo están organizados los datos:
- Cada "referencia" agrupa prendas por su precio de venta (por ejemplo "70.000" son las prendas que se venden a $70.000). Algunas referencias tienen nombre propio.
- "ganancia_bruta" = ventas − costo de compra de las prendas vendidas. No incluye los gastos.
- Las vendedoras vienen como "Vendedora 1", "Vendedora 2"… no tienen los mismos turnos, así que compáralas por venta promedio, no por total.
- "por_que_cambio_ganancia" ya trae el cambio de la ganancia repartido en pesos entre causas, y esas causas suman exactamente el total.
- "proyeccion" mira hacia adelante (de hoy al fin del mes subsiguiente): la venta esperada por mes y, por referencia, cuántas prendas se esperan vender cada mes, el stock de hoy, lo que viene en facturas sin recibir, hasta cuándo alcanzaría y "faltan_comprar_para_cubrir_hasta_fin_de_mes". Esas cuentas ya están hechas: úsalas tal cual, no las recalcules.
- Si preguntan cuánto comprar o cuánto tener para una fecha, responde con esos números (por ejemplo, para tener cubierto diciembre: "faltan_comprar_para_cubrir_hasta_fin_de_mes" de diciembre) y aclara en una línea el supuesto que está en "como_se_calculo".
Cómo responder:
- En español de Colombia, claro y directo, como le hablarías a un comerciante. Tutea.
- Corto: máximo unas 180 palabras. Usa viñetas que empiecen con "- " y **negrilla** solo para lo más importante. Nada de títulos ni tablas.
- Usa solo los datos del resumen. No inventes cifras, causas externas ni datos que no estén. Si los datos no alcanzan para responder, dilo.
- Pesos con punto de miles y sin decimales ($1.250.000). Porcentajes sin decimales.
- Cuando tenga sentido, termina con una o dos acciones concretas que Nelson pueda hacer esta semana.`;

let appCheck = null;
export function activarAppCheck(claveSitio) {
  if (appCheck || !claveSitio) return;
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(claveSitio),
    isTokenAutoRefreshEnabled: true,
  });
}

let ai = null;
// conPensamiento: los modelos nuevos "piensan" antes de responder; se les pide
// que piensen poco (respuesta más rápida). Si el modelo no acepta esa opción,
// se vuelve a intentar sin ella.
function modelo(nombre, conPensamiento) {
  if (!ai) ai = getAI(app, { backend: new GoogleAIBackend() });
  const generationConfig = { temperature: 0.4, maxOutputTokens: 4096 };
  if (conPensamiento) generationConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  return getGenerativeModel(ai, { model: nombre, systemInstruction: INSTRUCCIONES, generationConfig });
}

// Si algo se queda esperando para siempre (antes la pantalla se quedaba en
// "Pensando…" sin decir nada), se corta con un error que dice dónde fue.
class TiempoAgotado extends Error {}
function conTiempo(promesa, ms, mensaje) {
  let t;
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => {
      t = setTimeout(() => rechazar(new TiempoAgotado(mensaje)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

// Los errores de Firebase AI traen el código HTTP entre corchetes, por
// ejemplo "Error fetching from https://…:generateContent: [429 ] …".
function estadoHTTP(e) {
  const m = String(e?.message || '').match(/\[(\d{3})\b/);
  return m ? Number(m[1]) : null;
}
function esAppCheck(e) {
  return /app.?check|recaptcha|attestation/i.test(`${e?.code || ''} ${e?.message || ''}`) || estadoHTTP(e) === 401;
}
function sinInternet(e) {
  return !estadoHTTP(e) && /failed to fetch|network|offline/i.test(String(e?.message || ''));
}

function explicarError(e) {
  const t = `${e?.code || ''} ${e?.message || e}`;
  const http = estadoHTTP(e);
  if (e instanceof TiempoAgotado) return e.message;
  if (esAppCheck(e))
    return 'La IA todavía no reconoce la app (App Check). Revisa que la clave de reCAPTCHA esté bien pegada y registrada en Firebase → App Check, y recarga la página.';
  if (http === 429 || /resource.?exhausted|quota exceeded/i.test(t))
    return 'Google dice que se acabó el cupo gratis de la IA. Si apenas la estás estrenando, puede que el cupo de este modelo no esté disponible en el plan gratis.';
  if (http === 403 || /api has not been used|is disabled|SERVICE_DISABLED|PERMISSION_DENIED/i.test(t))
    return 'Falta activar la IA en Firebase: en la consola, AI Services → AI Logic → "Get started" con la Gemini Developer API. Si ya lo hiciste, espera unos minutos y vuelve a intentar.';
  if (http === 404) return 'El modelo de IA no está disponible para este proyecto.';
  if (sinInternet(e)) return 'No hay internet en este momento. Intenta de nuevo cuando vuelva la señal.';
  return 'La IA no pudo responder.';
}

// historial: [{ rol: 'yo' | 'ia', texto }] de la conversación hasta ahora.
// onTexto(textoParcial) se llama a medida que va llegando la respuesta.
// onEstado('verificando' | 'pensando' | 'escribiendo') para mostrar en qué va.
export async function preguntarIA({ historial, pregunta, onTexto, onEstado = () => {} }) {
  const history = historial.map((m) => ({ role: m.rol === 'yo' ? 'user' : 'model', parts: [{ text: m.texto }] }));
  const detalles = [];

  // 1. App Check: que reCAPTCHA confirme que la pregunta sale de la app.
  onEstado('verificando');
  if (!appCheck) {
    const err = new Error('La IA todavía no está encendida: falta la clave de reCAPTCHA.');
    throw err;
  }
  try {
    await conTiempo(
      getToken(appCheck),
      20000,
      'reCAPTCHA no respondió en 20 segundos. Revisa que la clave sea la del proyecto evejeans y que tenga los dominios evejeans.web.app y evejeans.firebaseapp.com.'
    );
  } catch (e) {
    console.error('IA (App Check):', e);
    const err = new Error(
      e instanceof TiempoAgotado
        ? e.message
        : 'reCAPTCHA no aceptó la app. Revisa que la clave esté bien pegada y registrada en Firebase → App Check, y recarga la página.'
    );
    if (!(e instanceof TiempoAgotado)) err.detalle = `App Check: ${e?.code || ''} ${String(e?.message || e).slice(0, 220)}`;
    throw err;
  }

  // 2. La pregunta, probando modelos y opciones en orden.
  const intentos = [];
  MODELOS.forEach((m) => intentos.push({ nombre: m, conPensamiento: true }, { nombre: m, conPensamiento: false }));
  let ultimoError = null;
  for (let k = 0; k < intentos.length; k++) {
    const { nombre, conPensamiento } = intentos[k];
    let texto = '';
    try {
      onEstado('pensando');
      const chat = modelo(nombre, conPensamiento).startChat({ history });
      const res = await conTiempo(chat.sendMessageStream(pregunta), 60000, 'La IA no contestó en 60 segundos.');
      const it = res.stream[Symbol.asyncIterator]();
      for (;;) {
        const paso = await conTiempo(it.next(), texto ? 30000 : 60000, 'La IA se quedó callada a mitad de la respuesta.');
        if (paso.done) break;
        const parte = paso.value.text();
        if (parte) {
          texto += parte;
          onEstado('escribiendo');
          onTexto(texto);
        }
      }
      if (!texto.trim()) throw new Error('La IA respondió vacío.');
      return texto;
    } catch (e) {
      console.error(`IA (${nombre}${conPensamiento ? '' : ', sin pensar'}):`, e);
      ultimoError = e;
      detalles.push(`${nombre}${conPensamiento ? '' : ' (sin pensar)'}: ${estadoHTTP(e) || e?.code || ''} ${String(e?.message || e).slice(0, 220)}`);
      if (texto || esAppCheck(e) || sinInternet(e)) break;
      // "Sin pensar" solo se intenta si el problema fue esa opción o la respuesta vacía.
      const porPensamiento = /think/i.test(String(e?.message || '')) || /vacío/.test(String(e?.message || ''));
      if (conPensamiento && !porPensamiento) k++;
    }
  }
  const err = new Error(explicarError(ultimoError));
  err.detalle = detalles.join(' | ');
  throw err;
}
