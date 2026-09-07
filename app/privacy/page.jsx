'use client';
// app/privacy/page.jsx
//
// Politique de confidentialité — page publique, servie en clair sur
// https://meetaaron.app/privacy sans authentification.
//
// Refonte du 07/09/2026 (demande Alex : « quand on va ajouter iOS et Android,
// il faut s'assurer que la privacy policy soit à jour »). Trois lecteurs
// exigeants pour cette page, chacun avec ses propres attentes :
//   - Google (vérification OAuth, scopes Gmail restreints) : la clause
//     Limited Use en anglais, mot pour mot, et la cohérence entre ce qui est
//     déclaré ici et ce que fait réellement l'application.
//   - Apple App Store et Google Play : une politique accessible par URL, qui
//     nomme les prestataires, précise la conservation, et — exigence Google
//     Play — décrit comment supprimer son compte (section « Supprimer votre
//     compte », ancre #delete-account).
//   - Le RGPD : responsable de traitement identifié, bases légales, transferts
//     hors UE, droits des personnes — y compris ceux des PROSPECTS, qui ne
//     sont pas nos utilisateurs mais dont on traite les données.
//
// Bilingue : français si la langue de l'utilisateur est le français, anglais
// sinon (les relecteurs Google et Apple lisent en anglais ; les cinq autres
// langues de l'app retombent sur l'anglais, une politique n'a pas besoin des
// sept). Le texte est la source de vérité : ne rien y écrire que le code ne
// fasse pas réellement.
import { useLocale } from '@/lib/i18n';

const UPDATED = { fr: '7 septembre 2026', en: '7 September 2026' };

function FrenchPolicy() {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p className="updated">Dernière mise à jour : {UPDATED.fr}</p>

      <p>
        Meet Aaron (« nous », « le service ») est un assistant commercial fondé sur l'intelligence
        artificielle, accessible sur meetaaron.app et, à terme, via ses applications mobiles.
        Cette politique explique quelles données nous traitons, pourquoi, avec qui, et comment vous
        gardez la main dessus.
      </p>

      <h2>1. Qui est responsable</h2>
      <p>
        Le service est édité par <strong>MEET AARON</strong>, entreprise individuelle
        d'Alexandre Fevre, immatriculée en Australie sous l'ABN 72 369 751 951, établie à Perth
        (Australie-Occidentale). Contact pour toute question relative à vos données :{' '}
        <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a>.
      </p>
      <p>
        Pour les données de votre compte (identité, connexion, facturation, usage du service), Meet
        Aaron est <strong>responsable du traitement</strong>. Pour les données de vos prospects et
        de vos échanges avec eux, c'est <strong>vous</strong> — ou votre entreprise — qui êtes
        responsable du traitement, et Meet Aaron agit comme <strong>sous-traitant</strong>, sur vos
        instructions.
      </p>

      <h2>2. Qui utilise Meet Aaron</h2>
      <p>
        Meet Aaron est un outil strictement professionnel (B2B), destiné aux commerciaux et à leurs
        entreprises. Il n'est pas conçu pour un usage personnel ni pour des mineurs, et nous ne
        collectons pas sciemment de données de personnes de moins de 18 ans.
      </p>

      <h2>3. Les données que nous traitons</h2>
      <ul>
        <li><strong>Votre compte</strong> : nom, adresse email, société, langue, préférences.</li>
        <li>
          <strong>Votre messagerie</strong> : lorsque vous connectez Gmail ou Outlook, Aaron lit les
          réponses de vos prospects à vos emails de prospection, envoie des emails en votre nom, et
          pose un libellé « Géré par Aaron » sur les fils qu'il traite. Il ne lit pas votre boîte
          dans son ensemble : seulement les conversations qu'il a lui-même ouvertes.
        </li>
        <li>
          <strong>Votre agenda</strong> : Aaron crée des rendez-vous dans Google Agenda ou Outlook
          quand un prospect accepte un créneau, et consulte vos événements pour éviter les
          doublons. Il ne touche jamais aux paramètres ni au partage de votre agenda.
        </li>
        <li>
          <strong>Vos prospects</strong> : nom, fonction, email, téléphone, société, et le contenu
          des échanges. Ces données viennent de vous (import de fichier), de sources publiques
          d'entreprises (voir section 5), ou des réponses des prospects eux-mêmes.
        </li>
        <li>
          <strong>Vos documents</strong> (devis types, tarifs, plaquettes), pour qu'Aaron adapte ses
          messages à votre métier.
        </li>
        <li><strong>Votre facturation</strong> : traitée par Stripe ; nous ne stockons aucun numéro de carte.</li>
        <li>
          <strong>Les notifications</strong> : si vous les activez, un identifiant technique
          d'abonnement push par appareil.
        </li>
        <li>
          <strong>Les données techniques</strong> habituelles (adresse IP, navigateur, journaux
          d'erreurs), nécessaires au fonctionnement et à la sécurité.
        </li>
      </ul>

      <h2>4. Pourquoi nous les traitons</h2>
      <p>Uniquement pour :</p>
      <ul>
        <li>faire fonctionner la prospection que vous avez configurée, et rien d'autre ;</li>
        <li>rédiger des emails et des réponses à l'aide de modèles d'intelligence artificielle ;</li>
        <li>afficher votre pipeline, vos statistiques et l'historique de vos échanges ;</li>
        <li>vous prévenir (rendez-vous, réponses, budget) ;</li>
        <li>facturer votre abonnement et sécuriser le service.</li>
      </ul>
      <p>
        Bases légales : l'exécution du contrat qui nous lie (votre abonnement), notre intérêt
        légitime à sécuriser et améliorer le service, et votre consentement pour les accès à votre
        messagerie et à votre agenda, que vous pouvez retirer à tout moment.
      </p>
      <p>Nous ne vendons jamais vos données ni celles de vos prospects, et n'en faisons aucun usage publicitaire.</p>

      <h2>5. Avec qui les données transitent</h2>
      <p>Pour faire fonctionner le service, nous nous appuyons sur des prestataires techniques :</p>
      <ul>
        <li><strong>Anthropic</strong> (États-Unis) et <strong>OpenAI</strong> (États-Unis) — modèles d'intelligence artificielle qui rédigent et classent les messages. Ces prestataires n'utilisent pas vos données pour entraîner leurs modèles et ne les conservent que temporairement, à des fins de sécurité.</li>
        <li><strong>Google</strong> et <strong>Microsoft</strong> — Gmail, Outlook et agendas, uniquement dans la limite des accès que vous autorisez.</li>
        <li><strong>Supabase</strong> — base de données et stockage des fichiers.</li>
        <li><strong>Vercel</strong> (États-Unis) — hébergement de l'application.</li>
        <li><strong>Stripe</strong> — paiements et facturation.</li>
      </ul>
      <p>
        Pour trouver et vérifier des entreprises, Aaron consulte aussi des <strong>sources
        publiques</strong> : registres officiels (INSEE-SIRENE en France, Companies House au
        Royaume-Uni, ABN Lookup en Australie) et annuaires d'établissements sous licence ouverte.
        Ces sources ne reçoivent aucune donnée de votre part.
      </p>
      <p>
        Certains prestataires sont établis hors de l'Union européenne, principalement aux
        États-Unis. Ces transferts reposent sur les clauses contractuelles types de la Commission
        européenne et, le cas échéant, sur le Data Privacy Framework.
      </p>

      <h2>6. Utilisation limitée des données Google et Microsoft</h2>
      <p>
        Meet Aaron's use and transfer to any other app of information received from Google APIs
        will adhere to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. The use of information received from Google
        Workspace scopes will adhere to the Google User Data Policy, including the Limited Use
        requirements.
      </p>
      <p>Le même engagement s'applique aux données reçues des API Microsoft. Concrètement, le contenu de votre messagerie et de votre agenda :</p>
      <ul>
        <li>ne sert qu'à fournir les fonctions que vous avez activées dans l'application ;</li>
        <li>n'est jamais vendu, ni transmis à des tiers pour leurs propres fins, ni utilisé pour de la publicité ;</li>
        <li>n'est jamais utilisé pour entraîner ou améliorer un modèle d'intelligence artificielle ;</li>
        <li>
          n'est lu par un humain que si vous nous le demandez expressément pour résoudre un
          problème, si la loi nous y oblige, ou pour des raisons de sécurité.
        </li>
      </ul>

      <h2>7. Les droits de vos prospects</h2>
      <p>
        Chaque email de prospection envoyé par Aaron indique à son destinataire qu'il peut, par une
        simple réponse, demander à ne plus être contacté ; Aaron enregistre cette demande et cesse
        le contact. Un prospect peut aussi exercer ses droits d'accès, de rectification ou
        d'effacement en écrivant à <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a> —
        nous transmettons la demande à l'entreprise responsable et l'aidons à y répondre.
      </p>

      <h2>8. Conservation</h2>
      <p>
        Vos données sont conservées tant que votre compte est actif, puis supprimées dans les
        30 jours suivant sa fermeture, à l'exception des données de facturation que la loi nous
        impose de garder. Les jetons d'accès à votre messagerie sont supprimés dès que vous
        déconnectez le compte concerné.
      </p>

      <h2 id="delete-account">9. Supprimer votre compte</h2>
      <p>
        Vous pouvez supprimer votre compte et l'ensemble des données associées vous-même, sans
        nous contacter : dans l'application, ouvrez <strong>Mon compte</strong>, puis l'onglet{' '}
        <strong>Supprimer mon compte</strong>, et confirmez. La suppression est définitive et
        effective sous 30 jours. Si vous n'avez plus accès à l'application, écrivez à{' '}
        <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a> depuis l'adresse de votre compte.
      </p>

      <h2>10. Sécurité</h2>
      <p>
        Les jetons d'accès à vos comptes Gmail et Outlook sont chiffrés avant stockage. L'accès à la
        base de données est restreint, journalisé, et les échanges avec nos prestataires se font
        exclusivement par connexions chiffrées.
      </p>

      <h2>11. Cookies et suivi</h2>
      <p>
        Nous n'utilisons que les cookies strictement nécessaires au fonctionnement (session,
        préférences). Aucun cookie publicitaire, aucun traqueur tiers.
      </p>

      <h2>12. Vos droits</h2>
      <p>
        Vous pouvez à tout moment consulter, corriger, exporter ou supprimer vos données, et
        déconnecter Meet Aaron de votre Gmail ou Outlook depuis l'écran <strong>Connexions</strong>{' '}
        — ou révoquer l'accès directement depuis les paramètres de sécurité de votre compte Google
        ou Microsoft. Vous pouvez aussi vous adresser à l'autorité de protection des données de
        votre pays (en France, la CNIL).
      </p>

      <h2>13. Contact et évolutions</h2>
      <p>
        Pour toute question : <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a>. Cette
        politique peut évoluer ; nous vous informerons de tout changement important, dans
        l'application ou par email.
      </p>

      <p className="footer-note">
        Voir aussi nos <a href="/terms">conditions générales d'utilisation</a>.
      </p>
    </>
  );
}

function EnglishPolicy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated: {UPDATED.en}</p>

      <p>
        Meet Aaron ("we", "the service") is an AI-powered sales assistant available at
        meetaaron.app and, in due course, through its mobile apps. This policy explains what data we
        process, why, with whom, and how you stay in control of it.
      </p>

      <h2>1. Who is responsible</h2>
      <p>
        The service is published by <strong>MEET AARON</strong>, the sole-trader business of
        Alexandre Fevre, registered in Australia under ABN 72 369 751 951 and based in Perth,
        Western Australia. Contact for any data-related question:{' '}
        <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a>.
      </p>
      <p>
        For your account data (identity, sign-in, billing, usage), Meet Aaron is the{' '}
        <strong>data controller</strong>. For the data of your prospects and your exchanges with
        them, <strong>you</strong> — or your company — are the controller, and Meet Aaron acts as
        your <strong>processor</strong>, on your instructions.
      </p>

      <h2>2. Who uses Meet Aaron</h2>
      <p>
        Meet Aaron is a strictly professional (B2B) tool for salespeople and their companies. It is
        not designed for personal use or for minors, and we do not knowingly collect data from
        anyone under 18.
      </p>

      <h2>3. The data we process</h2>
      <ul>
        <li><strong>Your account</strong>: name, email address, company, language, preferences.</li>
        <li>
          <strong>Your mailbox</strong>: when you connect Gmail or Outlook, Aaron reads the replies
          prospects send to your outreach emails, sends emails on your behalf, and applies a
          "Managed by Aaron" label to the threads it handles. It does not read your mailbox at
          large — only the conversations it started itself.
        </li>
        <li>
          <strong>Your calendar</strong>: Aaron creates events in Google Calendar or Outlook when a
          prospect accepts a meeting slot, and reads your events to avoid double-booking. It never
          touches calendar settings or sharing.
        </li>
        <li>
          <strong>Your prospects</strong>: name, job title, email, phone, company, and the content
          of the exchanges. This data comes from you (file import), from public company sources
          (see section 5), or from the prospects' own replies.
        </li>
        <li><strong>Your documents</strong> (sample quotes, price lists, brochures), so Aaron can tailor its messages to your business.</li>
        <li><strong>Billing</strong>: handled by Stripe; we never store card numbers.</li>
        <li><strong>Notifications</strong>: if you enable them, a technical push-subscription identifier per device.</li>
        <li><strong>Technical data</strong> (IP address, browser, error logs) needed to run and secure the service.</li>
      </ul>

      <h2>4. Why we process it</h2>
      <p>Solely to:</p>
      <ul>
        <li>run the outreach you configured, and nothing else;</li>
        <li>draft emails and replies using artificial-intelligence models;</li>
        <li>display your pipeline, statistics and conversation history;</li>
        <li>notify you (meetings, replies, budget);</li>
        <li>bill your subscription and secure the service.</li>
      </ul>
      <p>
        Legal bases: performance of our contract with you (your subscription), our legitimate
        interest in securing and improving the service, and your consent for access to your mailbox
        and calendar, which you can withdraw at any time.
      </p>
      <p>We never sell your data or your prospects' data, and never use it for advertising.</p>

      <h2>5. Who the data passes through</h2>
      <p>To run the service we rely on technical providers:</p>
      <ul>
        <li><strong>Anthropic</strong> (United States) and <strong>OpenAI</strong> (United States) — AI models that draft and classify messages. These providers do not use your data to train their models and retain it only temporarily, for safety purposes.</li>
        <li><strong>Google</strong> and <strong>Microsoft</strong> — Gmail, Outlook and calendars, strictly within the access you grant.</li>
        <li><strong>Supabase</strong> — database and file storage.</li>
        <li><strong>Vercel</strong> (United States) — application hosting.</li>
        <li><strong>Stripe</strong> — payments and invoicing.</li>
      </ul>
      <p>
        To find and verify companies, Aaron also consults <strong>public sources</strong>: official
        registers (INSEE-SIRENE in France, Companies House in the United Kingdom, ABN Lookup in
        Australia) and openly-licensed business directories. No data of yours is sent to these
        sources.
      </p>
      <p>
        Some providers are located outside the European Union, mainly in the United States. These
        transfers rely on the European Commission's Standard Contractual Clauses and, where
        applicable, the Data Privacy Framework.
      </p>

      <h2>6. Limited use of Google and Microsoft data</h2>
      <p>
        Meet Aaron's use and transfer to any other app of information received from Google APIs
        will adhere to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. The use of information received from Google
        Workspace scopes will adhere to the Google User Data Policy, including the Limited Use
        requirements.
      </p>
      <p>The same commitment applies to data received from Microsoft APIs. In practice, the content of your mailbox and calendar:</p>
      <ul>
        <li>is used only to provide the features you enabled in the application;</li>
        <li>is never sold, shared with third parties for their own purposes, or used for advertising;</li>
        <li>is never used to train or improve any artificial-intelligence model;</li>
        <li>is read by a human only if you expressly ask us to, to resolve a problem, if the law requires it, or for security reasons.</li>
      </ul>

      <h2>7. Your prospects' rights</h2>
      <p>
        Every outreach email Aaron sends tells its recipient that a simple reply is enough to ask
        not to be contacted again; Aaron records that request and stops. A prospect can also
        exercise their rights of access, rectification or erasure by writing to{' '}
        <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a> — we forward the request to the
        responsible company and help it respond.
      </p>

      <h2>8. Retention</h2>
      <p>
        Your data is kept while your account is active, then deleted within 30 days of closure,
        except billing records we are legally required to keep. Mailbox access tokens are deleted
        as soon as you disconnect the account concerned.
      </p>

      <h2 id="delete-account">9. Delete your account</h2>
      <p>
        You can delete your account and all associated data yourself, without contacting us: in
        the app, open <strong>My account</strong>, then the <strong>Delete my account</strong> tab,
        and confirm. Deletion is permanent and takes effect within 30 days. If you no longer have
        access to the app, email <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a> from
        your account address.
      </p>

      <h2>10. Security</h2>
      <p>
        Access tokens for your Gmail and Outlook accounts are encrypted before storage. Database
        access is restricted and logged, and all exchanges with our providers use encrypted
        connections.
      </p>

      <h2>11. Cookies and tracking</h2>
      <p>
        We only use cookies strictly necessary to operate the service (session, preferences). No
        advertising cookies, no third-party trackers.
      </p>

      <h2>12. Your rights</h2>
      <p>
        You can at any time view, correct, export or delete your data, and disconnect Meet Aaron
        from your Gmail or Outlook from the <strong>Connections</strong> screen — or revoke access
        directly from your Google or Microsoft account's security settings. You may also contact
        your country's data-protection authority.
      </p>

      <h2>13. Contact and changes</h2>
      <p>
        Any question: <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a>. This policy may
        change; we will inform you of any material change in the app or by email.
      </p>

      <p className="footer-note">
        See also our <a href="/terms">terms of service</a>.
      </p>
    </>
  );
}

export default function PrivacyPage() {
  const [locale] = useLocale();
  const fr = locale === 'fr';
  return (
    <div className="wrap">
      <div className="content">
        <a href="/app/preferences" className="back-link">{fr ? '← Retour aux préférences' : '← Back to preferences'}</a>
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        {fr ? <FrenchPolicy /> : <EnglishPolicy />}
      </div>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
        .wrap {
          min-height: 100vh;
          background: #0b0e1a;
          color: #f4f1ea;
          font-family: 'Inter', sans-serif;
          padding: 3rem 1.5rem;
          display: flex;
          justify-content: center;
        }
        .content {
          max-width: 680px;
          width: 100%;
        }
        .back-link {
          display: inline-block;
          color: #8b90a8;
          font-size: 0.82rem;
          text-decoration: none;
          margin-bottom: 1.5rem;
        }
        .back-link:hover {
          color: #f4f1ea;
        }
        .logo {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          margin-bottom: 1.5rem;
        }
        .content :global(h1) {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.8rem;
          margin: 0 0 0.4rem;
        }
        .content :global(.updated) {
          color: #8b90a8;
          font-size: 0.82rem;
          margin: 0 0 2rem;
        }
        .content :global(h2) {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.1rem;
          margin: 2rem 0 0.8rem;
        }
        .content :global(p),
        .content :global(li) {
          color: #c7cadb;
          font-size: 0.92rem;
          line-height: 1.6;
        }
        .content :global(ul) {
          padding-left: 1.2rem;
        }
        .content :global(li) {
          margin-bottom: 0.4rem;
        }
        .content :global(a) {
          color: #4b39ef;
        }
        .content :global(.footer-note) {
          margin-top: 2.5rem;
          color: #8b90a8;
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}
