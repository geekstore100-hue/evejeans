import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
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
Cómo responder:
- En español de Colombia, claro y directo, como le hablarías a un comerciante. Tutea.
- Corto: máximo unas 180 palabras. Usa viñetas que empiecen con "- " y **negrilla** solo para lo más importante. Nada de títulos ni tablas.
- Usa solo los datos del resumen. No inventes cifras, causas externas ni datos que no estén. Si los datos no alcanzan para responder, dilo.
- Pesos con punto de miles y sin decimales ($1.250.000). Porcentajes sin decimales.
- Cuando tenga sentido, termina con una o dos acciones concretas que Nelson pueda hacer esta semana.`;

let appCheckActivo = false;
export function activarAppCheck(claveSitio) {
  if (appCheckActivo || !claveSitio) return;
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(claveSitio),
    isTokenAutoRefreshEnabled: true,
  });
  appCheckActivo = true;
}

let ai = null;
function modelo(nombre) {
  if (!ai) ai = getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    model: nombre,
    systemInstruction: INSTRUCCIONES,
    generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
  });
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
export async function preguntarIA({ historial, pregunta, onTexto }) {
  const history = historial.map((m) => ({ role: m.rol === 'yo' ? 'user' : 'model', parts: [{ text: m.texto }] }));
  let ultimoError = null;
  const detalles = [];
  for (const nombre of MODELOS) {
    let texto = '';
    try {
      const chat = modelo(nombre).startChat({ history });
      const res = await chat.sendMessageStream(pregunta);
      for await (const parte of res.stream) {
        texto += parte.text();
        onTexto(texto);
      }
      if (!texto.trim()) throw new Error('La IA respondió vacío.');
      return texto;
    } catch (e) {
      console.error(`IA (${nombre}):`, e);
      ultimoError = e;
      detalles.push(`${nombre}: ${estadoHTTP(e) || e?.code || ''} ${String(e?.message || e).slice(0, 220)}`);
      // Si ya alcanzó a escribir algo, o el problema es de configuración o de
      // internet, no tiene sentido intentar con otro modelo.
      if (texto || esAppCheck(e) || sinInternet(e)) break;
    }
  }
  const err = new Error(explicarError(ultimoError));
  err.detalle = detalles.join(' | ');
  throw err;
}
