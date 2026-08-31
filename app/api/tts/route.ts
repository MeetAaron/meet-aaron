// app/api/tts/route.ts
// POST { text, locale } -> audio/mpeg : lecture vocale d'un message d'Aaron
// avec une voix naturelle (docx Modifs Aaron, AJOUTS 30/08/26, item 10 —
// retour Alex 31/08 : "on dirait un robot, je veux quelque chose de plus
// moderne comme la voix ChatGPT quand il te parle").
//
// La voix "ChatGPT" est celle de l'API de synthèse vocale d'OpenAI : on
// l'utilise directement (modèle gpt-4o-mini-tts, voix "nova" — chaleureuse,
// naturelle, multilingue). Le texte reste généré par Claude comme avant ;
// seule la mise en voix passe par OpenAI. Coût négligeable (~1 centime pour
// un message long), non compté dans le plafond API Claude.
//
// Sans clé OPENAI_API_KEY sur Vercel, la route répond 501 et le chat retombe
// automatiquement sur la voix du navigateur (comportement d'avant), sans
// erreur visible — voir speakMessage dans app/app/chat/page.jsx.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';

const MAX_CHARS = 3000; // garde-fou coût : un message du chat dépasse rarement 1500 caractères
const TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_VOICE = 'nova';

// Consigne de ton par langue (le modèle gpt-4o-mini-tts accepte une
// instruction de style) — voix posée de commercial senior, pas de lecture
// monotone.
const STYLE_BY_LOCALE: Record<string, string> = {
  fr: "Parle en français avec une voix chaleureuse, naturelle et posée, comme un collègue commercial expérimenté qui explique calmement. Rythme fluide, pas monotone.",
  en: 'Speak in English with a warm, natural, composed voice, like an experienced sales colleague explaining calmly. Fluid rhythm, not monotone.',
  de: 'Sprich auf Deutsch mit einer warmen, natürlichen, ruhigen Stimme, wie ein erfahrener Vertriebskollege, der gelassen erklärt.',
  it: 'Parla in italiano con una voce calda, naturale e pacata, come un collega commerciale esperto che spiega con calma.',
  es: 'Habla en español con una voz cálida, natural y serena, como un compañero comercial experimentado que explica con calma.',
  pt: 'Fala em português com uma voz calorosa, natural e serena, como um colega comercial experiente que explica com calma.',
  nl: 'Spreek in het Nederlands met een warme, natuurlijke, rustige stem, zoals een ervaren verkoopcollega die kalm uitlegt.',
};

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Voix naturelle non configurée (OPENAI_API_KEY manquante)' }, { status: 501 });
  }

  const { text, locale } = await request.json();
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Texte manquant' }, { status: 400 });
  }

  // Nettoyage léger : les marqueurs markdown (**, ##, listes) se lisent mal.
  const cleaned = text
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .trim()
    .slice(0, MAX_CHARS);

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: cleaned,
      instructions: STYLE_BY_LOCALE[locale] || STYLE_BY_LOCALE.fr,
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Erreur synthèse vocale OpenAI:', err);
    return NextResponse.json({ error: 'Erreur de synthèse vocale' }, { status: 502 });
  }

  const audio = await res.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
