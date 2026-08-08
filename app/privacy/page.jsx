// app/privacy/page.jsx
export default function PrivacyPage() {
  return (
    <div className="wrap">
      <div className="content">
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        <h1>Politique de confidentialité</h1>
        <p className="updated">Dernière mise à jour : 8 août 2026</p>

        <p>
          Meet Aaron ("nous", "notre service") est un assistant commercial basé sur l'intelligence
          artificielle, édité par Open X. Cette politique explique quelles données nous collectons,
          pourquoi, et comment vous pouvez les contrôler.
        </p>

        <h2>1. Qui utilise Meet Aaron ?</h2>
        <p>
          Meet Aaron est un outil B2B destiné aux commerciaux et à leurs entreprises. Il n'est pas
          conçu pour un usage personnel ou par des mineurs.
        </p>

        <h2>2. Quelles données nous collectons</h2>
        <p>Pour fonctionner, Meet Aaron collecte et traite :</p>
        <ul>
          <li><strong>Vos informations de compte</strong> : nom, adresse email, société.</li>
          <li>
            <strong>Vos emails</strong> : lorsque vous connectez votre compte Gmail ou Outlook,
            Aaron lit les réponses de vos prospects et envoie des emails en votre nom, dans le cadre
            strict de la prospection commerciale que vous configurez.
          </li>
          <li>
            <strong>Votre calendrier</strong> : Aaron crée des rendez-vous dans votre calendrier
            (Google Calendar ou Outlook Calendar) une fois que vous validez un créneau proposé.
          </li>
          <li>
            <strong>Les informations de vos prospects</strong> : nom, email, téléphone, société,
            poste, et le contenu des échanges avec eux.
          </li>
          <li>
            <strong>Les documents que vous téléversez</strong> (devis types, tarifs, brochures),
            utilisés pour qu'Aaron adapte ses messages à votre métier.
          </li>
          <li>
            <strong>Les données techniques</strong> habituelles (adresse IP, type de navigateur)
            nécessaires au bon fonctionnement du service.
          </li>
        </ul>

        <h2>3. Comment nous utilisons ces données</h2>
        <p>Vos données servent uniquement à :</p>
        <ul>
          <li>Faire fonctionner la prospection automatisée que vous avez configurée ;</li>
          <li>Générer des emails et des réponses via un modèle d'intelligence artificielle (Claude, développé par Anthropic) ;</li>
          <li>Afficher votre tableau de bord, vos statistiques et l'historique de vos échanges ;</li>
          <li>Vous envoyer des notifications liées à vos rendez-vous ou à votre activité.</li>
        </ul>
        <p>
          Nous ne vendons jamais vos données, ni celles de vos prospects, à des tiers à des fins
          publicitaires.
        </p>

        <h2>4. Avec qui nous partageons les données</h2>
        <p>Certaines données transitent par des prestataires techniques que nous utilisons pour faire fonctionner le service :</p>
        <ul>
          <li><strong>Anthropic</strong> (génération des réponses d'Aaron) ;</li>
          <li><strong>Google</strong> et <strong>Microsoft</strong> (Gmail, Outlook, Calendar — uniquement les accès que vous autorisez explicitement) ;</li>
          <li><strong>Supabase</strong> (hébergement de la base de données et des fichiers) ;</li>
          <li><strong>Vercel</strong> (hébergement de l'application).</li>
        </ul>
        <p>Chacun de ces prestataires est soumis à ses propres engagements de confidentialité et de sécurité.</p>

        <h2>5. Conservation des données</h2>
        <p>
          Vos données sont conservées tant que votre compte est actif. Vous pouvez demander la
          suppression de votre compte et des données associées à tout moment en nous contactant
          (voir section 8).
        </p>

        <h2>6. Sécurité</h2>
        <p>
          Les jetons d'accès à vos comptes Gmail/Outlook sont chiffrés avant d'être stockés. L'accès
          à la base de données est restreint et protégé.
        </p>

        <h2>7. Vos droits</h2>
        <p>
          Vous pouvez à tout moment consulter, corriger ou supprimer vos données, et déconnecter
          l'accès de Meet Aaron à votre Gmail/Outlook depuis l'écran "Connexions" de l'application,
          ou en révoquant l'accès directement depuis les paramètres de sécurité de votre compte
          Google ou Microsoft.
        </p>

        <h2>8. Contact</h2>
        <p>
          Pour toute question concernant cette politique ou vos données, contactez-nous à :{' '}
          <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a>.
        </p>

        <p className="footer-note">
          Cette politique peut être mise à jour. Nous vous informerons de tout changement important.
        </p>
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
        .logo {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          margin-bottom: 1.5rem;
        }
        h1 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.8rem;
          margin: 0 0 0.4rem;
        }
        .updated {
          color: #8b90a8;
          font-size: 0.82rem;
          margin: 0 0 2rem;
        }
        h2 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.1rem;
          margin: 2rem 0 0.8rem;
        }
        p, li {
          color: #c7cadb;
          font-size: 0.92rem;
          line-height: 1.6;
        }
        ul {
          padding-left: 1.2rem;
        }
        li {
          margin-bottom: 0.4rem;
        }
        a {
          color: #4b39ef;
        }
        .footer-note {
          margin-top: 2.5rem;
          color: #8b90a8;
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}
