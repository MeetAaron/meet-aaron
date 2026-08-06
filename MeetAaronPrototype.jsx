"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Calendar, Users, Target, BarChart3, Radar, Settings, ChevronRight,
  Check, Clock, X, MapPin, Video, Phone, Sparkles, Building2, ArrowUpRight,
  ArrowRight, TrendingUp, Menu
} from "lucide-react";

/* ---------------------------------------------------------------
   MEET AARON — prototype cliquable du produit
   Données simulées, persistées en local via window.storage.
   Objectif : donner une démo fonctionnelle de l'UX à faire tester,
   pas une intégration réelle (pas d'envoi d'email, pas d'IA connectée).
----------------------------------------------------------------*/

const GOLD = "#E7A33E";
const INK = "#171B29";
const PAPER = "#F6F4EF";
const TEAL = "#4E9E8E";
const MUTED = "#8B8FA3";
const CORAL = "#D96A5C";

const seedContacts = [
  {
    id: "c1", name: "Sophie Marchand", company: "Atelier Bruma", role: "Directrice achats",
    status: "rdv", channel: "email", value: 4200,
    profile: "Analytique", lastTouch: "il y a 1 jour",
    history: [
      { who: "aaron", text: "Premier email de prospection envoyé — offre AP présentée." },
      { who: "prospect", text: "Répond : \"Pouvez-vous détailler la tarification ?\"" },
      { who: "aaron", text: "Envoi de la grille tarifaire + proposition de créneau visio." },
    ],
    advice: "Profil analytique : elle a demandé les chiffres avant tout. Misez sur l'ancrage — montrez d'abord AC (le plus complet) pour que AP paraisse raisonnable. Évitez le storytelling, elle veut des faits vérifiables.",
    nextRdv: { date: "Auj. 14:30", type: "visio" },
  },
  {
    id: "c2", name: "Karim Belhadj", company: "Nova Fret", role: "Gérant",
    status: "prospection", channel: "linkedin", value: 2800,
    profile: "Dominant", lastTouch: "il y a 3h",
    history: [
      { who: "aaron", text: "Message LinkedIn envoyé, mise en avant du gain de temps." },
      { who: "prospect", text: "Vu, pas de réponse depuis 5 jours." },
    ],
    advice: "Aucune réponse depuis 5 jours → misez sur la rareté : rappelez que l'offre -50% du 1er mois a une échéance. Profil dominant : allez droit au but, un message court avec un chiffre concret convertit mieux qu'une relance polie.",
    nextRdv: null,
  },
  {
    id: "c3", name: "Léa Fontaine", company: "Studio Verrière", role: "Fondatrice",
    status: "gagne", channel: "email", value: 3600,
    profile: "Expressif", lastTouch: "il y a 2 jours",
    history: [
      { who: "aaron", text: "3 échanges email, RDV visio tenu le 28/07." },
      { who: "patron", text: "RDV marqué comme \"Client gagné\"." },
    ],
    advice: "Client gagné — bascule automatique vers le suivi de fidélisation (AC, phase 2). En attendant : un email de bienvenue chaleureux, elle est sensible au relationnel (profil expressif).",
    nextRdv: null,
  },
  {
    id: "c4", name: "Thomas Rey", company: "Rey Toiture", role: "Artisan",
    status: "indecis", channel: "email", value: 1900,
    profile: "Relationnel", lastTouch: "il y a 4 jours",
    history: [
      { who: "aaron", text: "RDV téléphonique tenu, client indécis sur le budget." },
    ],
    advice: "Indécis sur le prix. Cadrage recommandé : présenter le coût de l'inaction (\"chaque mois sans prospection structurée, ce sont des chantiers qui partent chez un concurrent\") plutôt que les bénéfices de l'outil.",
    nextRdv: null,
  },
  {
    id: "c5", name: "Amandine Roux", company: "Roux & Associés", role: "Associée",
    status: "perdu", channel: "email", value: 5200,
    profile: "Analytique", lastTouch: "il y a 9 jours",
    history: [
      { who: "aaron", text: "4 relances envoyées sur 3 semaines, aucune réponse." },
      { who: "patron", text: "Marqué comme prospect perdu." },
    ],
    advice: "Prospect perdu — Aaron retentera un contact dans 2 mois avec un angle différent (niveau de confiance ≥ 1 requis pour éviter les doublons).",
    nextRdv: null,
  },
  {
    id: "c6", name: "Yanis Cohen", company: "Cohen Digital", role: "CEO",
    status: "prospection", channel: "instagram", value: 3100,
    profile: "Expressif", lastTouch: "il y a 6h",
    history: [
      { who: "aaron", text: "Premier contact via Instagram, réponse positive à un post." },
    ],
    advice: "Contact très récent, chaud. Profil expressif : storytelling + preuve sociale (\"3 entreprises similaires utilisent déjà Aaron\") plutôt qu'une liste de fonctionnalités.",
    nextRdv: null,
  },
];

const statusMeta = {
  prospection: { label: "Prospection", color: MUTED },
  rdv: { label: "RDV pris", color: GOLD },
  gagne: { label: "Client gagné", color: TEAL },
  indecis: { label: "Indécis", color: "#C99B3F" },
  perdu: { label: "Perdu", color: CORAL },
};

const channelIcon = { email: "✉️", linkedin: "in", instagram: "◎" };

function useStoredState(key, initial) {
  // Stockage local navigateur (localStorage). Sera remplacé par la vraie
  // base de données une fois le backend branché (chaque utilisateur aura
  // ses données synchronisées sur tous ses appareils).
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw));
    } catch (e) {
      /* pas encore de valeur stockée, ou localStorage indisponible */
    } finally {
      setLoaded(true);
    }
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* stockage plein ou indisponible — on continue sans persister */
    }
  }, [value, loaded, key]);

  return [value, setValue, loaded];
}

function GaugeToday({ count }) {
  const max = 6;
  const pct = Math.min(count / max, 1);
  const angle = -90 + pct * 180;
  return (
    <svg viewBox="0 0 200 120" className="w-full max-w-[220px]">
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#2A3145" strokeWidth="14" strokeLinecap="round" />
      <path
        d="M 20 100 A 80 80 0 0 1 180 100"
        fill="none" stroke={GOLD} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${pct * 251} 251`}
      />
      <line
        x1="100" y1="100"
        x2={100 + 62 * Math.cos((angle * Math.PI) / 180)}
        y2={100 + 62 * Math.sin((angle * Math.PI) / 180)}
        stroke={PAPER} strokeWidth="3" strokeLinecap="round"
      />
      <circle cx="100" cy="100" r="6" fill={PAPER} />
      <text x="100" y="88" textAnchor="middle" fontSize="30" fontWeight="700" fill={PAPER}>{count}</text>
      <text x="100" y="112" textAnchor="middle" fontSize="11" fill={MUTED}>RDV aujourd'hui</text>
    </svg>
  );
}

function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ company: "", goal: "", tone: "vous", docsCount: 0 });
  const steps = [
    {
      title: "Bienvenue chez Aaron",
      body: (
        <div className="space-y-4">
          <p className="text-[15px] leading-relaxed" style={{ color: "#4B5060" }}>
            Aaron va prospecter pour votre entreprise. Deux minutes de configuration, puis il prend le relais.
          </p>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Nom de l'entreprise</label>
            <input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              placeholder="Open X"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-[15px] outline-none focus:ring-2"
              style={{ borderColor: "#DDD8CC", background: "#FFFFFF" }}
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Objectif principal</label>
            <input
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              placeholder="Remplir l'agenda commercial sans y passer mes journées"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-[15px] outline-none focus:ring-2"
              style={{ borderColor: "#DDD8CC", background: "#FFFFFF" }}
            />
          </div>
        </div>
      ),
    },
    {
      title: "Comment Aaron s'adresse à vos prospects",
      body: (
        <div className="space-y-3">
          {[
            { v: "tu", l: "Tutoiement", d: "Ton direct, décontracté" },
            { v: "vous", l: "Vouvoiement", d: "Ton formel, classique B2B" },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => setForm({ ...form, tone: o.v })}
              className="w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition"
              style={{
                borderColor: form.tone === o.v ? GOLD : "#DDD8CC",
                background: form.tone === o.v ? "#FBF0DC" : "#FFFFFF",
              }}
            >
              <span>
                <div className="font-medium text-[15px]">{o.l}</div>
                <div className="text-xs" style={{ color: MUTED }}>{o.d}</div>
              </span>
              {form.tone === o.v && <Check size={18} color={GOLD} />}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Niveau de confiance",
      body: (
        <div className="space-y-3">
          <p className="text-[14px]" style={{ color: "#4B5060" }}>
            Plus vous partagez de documents, plus Aaron est précis. Vous pourrez tout ajuster plus tard dans "Mes préférences".
          </p>
          <div className="rounded-lg border-2 border-dashed p-6 text-center" style={{ borderColor: "#DDD8CC" }}>
            <p className="text-[14px]" style={{ color: MUTED }}>Glissez vos devis, factures, photos de réalisations ici</p>
            <button
              onClick={() => setForm({ ...form, docsCount: form.docsCount + 3 })}
              className="mt-3 rounded-full px-4 py-1.5 text-sm font-medium"
              style={{ background: INK, color: PAPER }}
            >
              Simuler l'ajout de 3 documents
            </button>
            {form.docsCount > 0 && (
              <p className="mt-2 text-xs" style={{ color: TEAL }}>{form.docsCount} documents ajoutés — niveau 1 atteint</p>
            )}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(16,19,28,0.72)" }}>
      <div className="w-full max-w-md rounded-2xl p-7 shadow-2xl" style={{ background: PAPER }}>
        <div className="flex items-center gap-2 mb-1">
          {steps.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? GOLD : "#E4DFD2" }} />
          ))}
        </div>
        <p className="text-xs mt-4 font-medium tracking-wide uppercase" style={{ color: MUTED }}>Étape {step + 1} / {steps.length}</p>
        <h2 className="text-xl font-semibold mt-1 mb-4" style={{ color: INK }}>{steps[step].title}</h2>
        {steps[step].body}
        <div className="mt-6 flex justify-between items-center">
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} className="text-sm font-medium" style={{ color: MUTED }}>Retour</button>
          ) : <span />}
          <button
            onClick={() => (step === steps.length - 1 ? onDone(form) : setStep(step + 1))}
            className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ background: GOLD, color: INK }}
          >
            {step === steps.length - 1 ? "Activer Aaron" : "Continuer"} <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition"
      style={{
        background: active ? "rgba(231,163,62,0.14)" : "transparent",
        color: active ? GOLD : "#B7BAC9",
      }}
    >
      <Icon size={17} strokeWidth={2} />
      <span className="flex-1 text-left">{label}</span>
      {badge ? (
        <span className="text-[11px] rounded-full px-1.5 py-0.5" style={{ background: active ? GOLD : "#2A3145", color: active ? INK : "#B7BAC9" }}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function AgendaView({ contacts }) {
  const todays = contacts.filter((c) => c.nextRdv);
  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6" style={{ background: INK }}>
        <GaugeToday count={todays.length} />
        <div className="flex-1">
          <p className="text-sm" style={{ color: "#B7BAC9" }}>Rapport du soir · 19h00</p>
          <p className="mt-1 text-[15px]" style={{ color: PAPER }}>
            Aaron vous enverra demain matin le récap de {todays.length} rendez-vous programmé{todays.length > 1 ? "s" : ""}.
            Rappel automatique 1h avant chacun (agenda + email + notification).
          </p>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: MUTED }}>Aujourd'hui</h3>
        <div className="space-y-3">
          {todays.length === 0 && (
            <p className="text-sm rounded-xl border border-dashed p-6 text-center" style={{ color: MUTED, borderColor: "#DDD8CC" }}>
              Rien de programmé aujourd'hui. Aaron continue de prospecter en arrière-plan — voir "Prospection en cours".
            </p>
          )}
          {todays.map((c) => (
            <div key={c.id} className="rounded-xl border p-4 flex items-center gap-4" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
              <div className="h-11 w-11 rounded-full flex items-center justify-center font-semibold" style={{ background: "#FBF0DC", color: GOLD }}>
                {c.name.split(" ").map((n) => n[0]).join("")}
              </div>
              <div className="flex-1">
                <p className="font-medium text-[15px]" style={{ color: INK }}>{c.name} · {c.company}</p>
                <p className="text-xs flex items-center gap-1" style={{ color: MUTED }}>
                  {c.nextRdv.type === "visio" ? <Video size={12} /> : c.nextRdv.type === "physique" ? <MapPin size={12} /> : <Phone size={12} />}
                  {c.nextRdv.date}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="rounded-full p-2" style={{ background: "#EAF4F1", color: TEAL }} title="Accepter"><Check size={15} /></button>
                <button className="rounded-full p-2" style={{ background: "#FBF0DC", color: GOLD }} title="Reporter"><Clock size={15} /></button>
                <button className="rounded-full p-2" style={{ background: "#FBEBE8", color: CORAL }} title="Annuler"><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactDetail({ contact, onStatusChange }) {
  const [tab, setTab] = useState("conseil");
  return (
    <div className="rounded-2xl border h-full flex flex-col" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
      <div className="p-5 border-b" style={{ borderColor: "#EFEBE0" }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-[16px]" style={{ color: INK }}>{contact.name}</p>
            <p className="text-sm flex items-center gap-1.5 mt-0.5" style={{ color: MUTED }}>
              <Building2 size={13} /> {contact.company} · {contact.role}
            </p>
          </div>
          <span className="text-xs font-medium rounded-full px-2.5 py-1" style={{ background: `${statusMeta[contact.status].color}22`, color: statusMeta[contact.status].color }}>
            {statusMeta[contact.status].label}
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          {["gagne", "indecis", "perdu"].map((s) => (
            <button
              key={s}
              onClick={() => onStatusChange(contact.id, s)}
              className="text-xs rounded-full px-3 py-1.5 border font-medium"
              style={{
                borderColor: contact.status === s ? statusMeta[s].color : "#DDD8CC",
                color: contact.status === s ? statusMeta[s].color : "#6B7080",
              }}
            >
              {statusMeta[s].label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex px-5 gap-5 border-b text-sm" style={{ borderColor: "#EFEBE0" }}>
        {[["conseil", "Conseil"], ["historique", "Historique"], ["fiche", "Fiche"]].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="py-3 font-medium"
            style={{ color: tab === k ? INK : MUTED, borderBottom: tab === k ? `2px solid ${GOLD}` : "2px solid transparent" }}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="p-5 flex-1 overflow-auto">
        {tab === "conseil" && (
          <div className="rounded-xl p-4" style={{ background: "#FBF0DC" }}>
            <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 mb-2" style={{ color: "#9C7326" }}>
              <Sparkles size={13} /> Profil {contact.profile}
            </p>
            <p className="text-[14px] leading-relaxed" style={{ color: "#5B4A26" }}>{contact.advice}</p>
          </div>
        )}
        {tab === "historique" && (
          <div className="space-y-3">
            {contact.history.map((h, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-2 w-2 mt-2 rounded-full shrink-0" style={{ background: h.who === "aaron" ? GOLD : h.who === "prospect" ? TEAL : MUTED }} />
                <div>
                  <p className="text-[11px] uppercase tracking-wide font-medium" style={{ color: MUTED }}>
                    {h.who === "aaron" ? "Aaron" : h.who === "prospect" ? contact.name.split(" ")[0] : "Vous"}
                  </p>
                  <p className="text-[14px]" style={{ color: "#3A3F4C" }}>{h.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "fiche" && (
          <div className="space-y-2 text-[14px]" style={{ color: "#3A3F4C" }}>
            <p><span style={{ color: MUTED }}>Canal : </span>{contact.channel}</p>
            <p><span style={{ color: MUTED }}>Valeur estimée : </span>{contact.value.toLocaleString("fr-FR")} €</p>
            <p><span style={{ color: MUTED }}>Dernier contact : </span>{contact.lastTouch}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientsView({ contacts, onStatusChange }) {
  const [filter, setFilter] = useState("tous");
  const [selected, setSelected] = useState(contacts[0]?.id);
  const filtered = filter === "tous" ? contacts : contacts.filter((c) => c.status === filter);
  const active = contacts.find((c) => c.id === selected) || filtered[0];

  return (
    <div className="grid md:grid-cols-[1fr_1.1fr] gap-5 h-full">
      <div>
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {["tous", ...Object.keys(statusMeta)].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="whitespace-nowrap text-xs font-medium rounded-full px-3 py-1.5 border"
              style={{
                borderColor: filter === f ? INK : "#DDD8CC",
                background: filter === f ? INK : "transparent",
                color: filter === f ? PAPER : "#6B7080",
              }}
            >
              {f === "tous" ? "Tous" : statusMeta[f].label}
            </button>
          ))}
        </div>
        <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left"
              style={{
                borderColor: active?.id === c.id ? GOLD : "#E4DFD2",
                background: active?.id === c.id ? "#FBF0DC" : "#FFFFFF",
              }}
            >
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0" style={{ background: "#EFEBE0", color: INK }}>
                {c.name.split(" ").map((n) => n[0]).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate" style={{ color: INK }}>{c.name}</p>
                <p className="text-xs truncate" style={{ color: MUTED }}>{c.company}</p>
              </div>
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: statusMeta[c.status].color }} />
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-[400px]">
        {active ? <ContactDetail contact={active} onStatusChange={onStatusChange} /> : (
          <div className="h-full flex items-center justify-center text-sm" style={{ color: MUTED }}>Sélectionnez un contact</div>
        )}
      </div>
    </div>
  );
}

function ResultsView({ contacts }) {
  const won = contacts.filter((c) => c.status === "gagne");
  const totalValue = won.reduce((s, c) => s + c.value, 0);
  const months = [
    { m: "Avr", v: 2 }, { m: "Mai", v: 3 }, { m: "Juin", v: 2 }, { m: "Juil", v: 4 }, { m: "Août", v: won.length },
  ];
  const max = Math.max(...months.map((m) => m.v), 1);
  const kpis = [
    { label: "Clients gagnés (30j)", value: won.length, icon: Target },
    { label: "Valeur générée", value: `${totalValue.toLocaleString("fr-FR")} €`, icon: TrendingUp },
    { label: "Prospects actifs", value: contacts.filter((c) => c.status === "prospection").length, icon: Radar },
  ];
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        {kpis.map((k, i) => (
          <div key={i} className="rounded-2xl border p-5" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
            <k.icon size={17} color={GOLD} />
            <p className="text-2xl font-semibold mt-3" style={{ color: INK }}>{k.value}</p>
            <p className="text-xs mt-1" style={{ color: MUTED }}>{k.label}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border p-6" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
        <p className="text-sm font-semibold mb-5" style={{ color: INK }}>Clients gagnés par mois</p>
        <div className="flex items-end gap-5 h-40">
          {months.map((m, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2">
              <div
                className="w-full rounded-t-md"
                style={{ height: `${(m.v / max) * 100}%`, background: i === months.length - 1 ? GOLD : "#E4DFD2", minHeight: 6 }}
              />
              <span className="text-xs" style={{ color: MUTED }}>{m.m}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProspectionView({ contacts }) {
  const items = contacts.filter((c) => c.status === "prospection");
  const steps = ["Contacté", "Relance", "Réponse", "RDV proposé"];
  return (
    <div className="space-y-3">
      {items.map((c) => {
        const stepIdx = c.history.length >= 2 ? 2 : 1;
        return (
          <div key={c.id} className="rounded-xl border p-4" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-[14px]" style={{ color: INK }}>{c.name} · {c.company}</p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>Canal : {c.channel} · dernier contact {c.lastTouch}</p>
              </div>
              <span className="text-lg">{channelIcon[c.channel] || "✉️"}</span>
            </div>
            <div className="flex items-center mt-4 gap-1">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center flex-1">
                  <div
                    className="h-2 flex-1 rounded-full"
                    style={{ background: i <= stepIdx ? GOLD : "#EFEBE0" }}
                  />
                  {i < steps.length - 1 && <div className="w-1" />}
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: MUTED }}>{steps[stepIdx]}</p>
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="text-sm text-center rounded-xl border border-dashed p-8" style={{ color: MUTED, borderColor: "#DDD8CC" }}>
          Aucune prospection active pour le moment.
        </p>
      )}
    </div>
  );
}

function PreferencesView({ prefs, setPrefs }) {
  return (
    <div className="max-w-lg space-y-6">
      <div className="rounded-2xl border p-5" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
        <p className="text-sm font-semibold mb-3" style={{ color: INK }}>Ton avec les prospects</p>
        <div className="flex gap-2">
          {[["vous", "Vouvoiement"], ["tu", "Tutoiement"]].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setPrefs({ ...prefs, tone: v })}
              className="flex-1 rounded-lg border py-2 text-sm font-medium"
              style={{
                borderColor: prefs.tone === v ? GOLD : "#DDD8CC",
                background: prefs.tone === v ? "#FBF0DC" : "transparent",
                color: prefs.tone === v ? "#9C7326" : "#6B7080",
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border p-5" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
        <p className="text-sm font-semibold mb-3" style={{ color: INK }}>Rythme de relance</p>
        <input
          type="range" min="1" max="5" value={prefs.followUpFreq}
          onChange={(e) => setPrefs({ ...prefs, followUpFreq: Number(e.target.value) })}
          className="w-full accent-[#E7A33E]"
        />
        <p className="text-xs mt-1" style={{ color: MUTED }}>{prefs.followUpFreq} relance{prefs.followUpFreq > 1 ? "s" : ""} avant mise en "prospect perdu"</p>
      </div>
      <div className="rounded-2xl border p-5 space-y-3" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
        <p className="text-sm font-semibold" style={{ color: INK }}>Rappels de rendez-vous</p>
        {["Agenda téléphone", "Email", "Notification Aaron"].map((l) => (
          <label key={l} className="flex items-center justify-between text-[14px]" style={{ color: "#3A3F4C" }}>
            {l}
            <input type="checkbox" defaultChecked className="accent-[#E7A33E] h-4 w-4" />
          </label>
        ))}
      </div>
    </div>
  );
}

function TeamView() {
  const team = [
    { name: "Marc D.", won: 6, prospecting: 9 },
    { name: "Inès L.", won: 4, prospecting: 7 },
    { name: "Vous (patron)", won: 3, prospecting: 5 },
  ];
  return (
    <div className="space-y-3">
      {team.map((t, i) => (
        <div key={i} className="rounded-xl border p-4 flex items-center gap-4" style={{ borderColor: "#E4DFD2", background: "#FFFFFF" }}>
          <div className="h-10 w-10 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: "#EFEBE0", color: INK }}>
            {t.name.split(" ").map((n) => n[0]).join("")}
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-medium" style={{ color: INK }}>{t.name}</p>
            <p className="text-xs" style={{ color: MUTED }}>{t.prospecting} prospects actifs</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold" style={{ color: TEAL }}>{t.won}</p>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: MUTED }}>gagnés</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MeetAaronPrototype() {
  const [contacts, setContacts] = useStoredState("meetaaron:contacts", seedContacts);
  const [prefs, setPrefs] = useStoredState("meetaaron:prefs", { tone: "vous", followUpFreq: 3 });
  const [onboarded, setOnboarded] = useStoredState("meetaaron:onboarded", false);
  const [tab, setTab] = useState("agenda");
  const [role, setRole] = useState("patron");
  const [mobileNav, setMobileNav] = useState(false);

  const handleStatusChange = (id, status) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
  };

  const navItems = useMemo(() => {
    const base = [
      { k: "agenda", l: "Mon agenda", icon: Calendar },
      { k: "clients", l: "Clients & prospects", icon: Users, badge: contacts.length },
      { k: "prospection", l: "Prospection en cours", icon: Radar, badge: contacts.filter((c) => c.status === "prospection").length },
      { k: "resultats", l: "Mes résultats", icon: BarChart3 },
      { k: "preferences", l: "Mes préférences", icon: Settings },
    ];
    if (role === "patron") base.splice(4, 0, { k: "equipe", l: "Mon équipe", icon: Building2 });
    return base;
  }, [role, contacts]);

  return (
    <div className="w-full min-h-[720px] flex flex-col md:flex-row rounded-2xl overflow-hidden" style={{ background: PAPER, fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      {!onboarded && <Onboarding onDone={() => setOnboarded(true)} />}

      {/* Sidebar */}
      <div className="md:w-60 shrink-0 p-4 flex md:flex-col gap-4" style={{ background: INK }}>
        <div className="flex items-center justify-between md:block">
          <div className="flex items-center gap-2 px-1">
            <div className="h-8 w-8 rounded-full flex items-center justify-center font-serif text-base" style={{ background: GOLD, color: INK }}>A</div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: PAPER, fontFamily: "Georgia, 'Times New Roman', serif" }}>Meet Aaron</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "#7C8098" }}>meetaaron.app</p>
            </div>
          </div>
          <button className="md:hidden" onClick={() => setMobileNav(!mobileNav)}>
            <Menu size={20} color={PAPER} />
          </button>
        </div>

        <div className={`${mobileNav ? "flex" : "hidden"} md:flex flex-col gap-3`}>
          <div className="flex rounded-full p-1 text-xs font-medium" style={{ background: "#232A3D" }}>
            {[["patron", "Patron"], ["salarie", "Commercial"]].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setRole(v)}
                className="flex-1 rounded-full py-1.5 transition"
                style={{ background: role === v ? GOLD : "transparent", color: role === v ? INK : "#B7BAC9" }}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1 mt-1">
            {navItems.map((n) => (
              <NavItem key={n.k} icon={n.icon} label={n.l} badge={n.badge} active={tab === n.k} onClick={() => { setTab(n.k); setMobileNav(false); }} />
            ))}
          </div>

          <div className="mt-auto pt-4 border-t hidden md:block" style={{ borderColor: "#232A3D" }}>
            <p className="text-[11px]" style={{ color: "#7C8098" }}>Connecté comme</p>
            <p className="text-[13px] font-medium" style={{ color: PAPER }}>Open X {role === "patron" ? "· Patron" : "· Commercial"}</p>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 p-5 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: INK }}>{navItems.find((n) => n.k === tab)?.l}</h1>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>Ton actuel : {prefs.tone === "tu" ? "tutoiement" : "vouvoiement"} · Aaron Prospect actif</p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5" style={{ background: "#EAF4F1", color: TEAL }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TEAL }} /> Aaron en ligne
          </div>
        </div>

        {tab === "agenda" && <AgendaView contacts={contacts} />}
        {tab === "clients" && <ClientsView contacts={contacts} onStatusChange={handleStatusChange} />}
        {tab === "prospection" && <ProspectionView contacts={contacts} />}
        {tab === "resultats" && <ResultsView contacts={contacts} />}
        {tab === "preferences" && <PreferencesView prefs={prefs} setPrefs={setPrefs} />}
        {tab === "equipe" && <TeamView />}
      </div>
    </div>
  );
}
