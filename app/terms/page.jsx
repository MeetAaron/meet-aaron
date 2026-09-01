'use client';
// app/terms/page.jsx
// Conditions générales d'utilisation et de vente (CGU/CGV).
//
// Cette page n'est pas seulement du confort juridique : elle est exigée par
// les deux plateformes dont dépendent nos connexions email/agenda.
//   - Microsoft Entra : champ « Conditions d'utilisation » de l'écran de
//     consentement (laissé vide jusqu'ici), demandé pour la vérification
//     d'éditeur.
//   - Google : la vérification OAuth des scopes restreints (Gmail) exige une
//     page de conditions ET une page de confidentialité publiques, sur le
//     domaine vérifié, accessibles sans authentification.
// Elle doit donc rester servie en clair sur https://meetaaron.app/terms,
// sans redirection vers /login. Même structure et même feuille de style que
// app/privacy/page.jsx pour que les deux pages se répondent.
export default function TermsPage() {
  return (
    <div className="wrap">
      <div className="content">
        <a href="/app/preferences" className="back-link">← Retour aux préférences</a>
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        <h1>Conditions générales d'utilisation</h1>
        <p className="updated">Dernière mise à jour : 1er septembre 2026</p>

        <p>
          Les présentes conditions encadrent l'utilisation de Meet Aaron, un assistant commercial
          basé sur l'intelligence artificielle accessible sur meetaaron.app. En créant un compte,
          vous les acceptez sans réserve.
        </p>

        <h2>1. Éditeur du service</h2>
        <p>
          Meet Aaron est édité par <strong>Open X</strong>.<br />
          Contact : <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a>
        </p>
        <p>
          Le service est hébergé par Vercel Inc. (application) et Supabase Inc. (base de données et
          fichiers).
        </p>

        <h2>2. Objet du service</h2>
        <p>
          Meet Aaron est un outil professionnel qui assiste les équipes commerciales : il rédige et
          envoie des emails de prospection en votre nom, suit les réponses de vos prospects, propose
          des créneaux de rendez-vous, tient à jour votre pipeline commercial et vous alerte sur les
          actions en attente.
        </p>
        <p>
          Aaron produit des <strong>propositions</strong>. Les emails, les devis et les rendez-vous
          générés par l'intelligence artificielle restent sous votre contrôle et sous votre
          responsabilité : c'est vous qui décidez ce qui part, à qui, et quand.
        </p>

        <h2>3. Qui peut utiliser Meet Aaron</h2>
        <p>
          Meet Aaron est un service strictement professionnel (B2B), réservé aux personnes majeures
          agissant dans le cadre de leur activité professionnelle. Il n'est destiné ni à un usage
          personnel, ni à des mineurs.
        </p>
        <p>
          Vous êtes responsable de la confidentialité de vos identifiants et de toute activité menée
          depuis votre compte. Prévenez-nous sans délai en cas d'utilisation non autorisée.
        </p>

        <h2>4. Abonnement, prix et résiliation</h2>
        <ul>
          <li>
            L'abonnement Aaron est facturé <strong>30 € par mois et par utilisateur</strong>, sans
            engagement de durée.
          </li>
          <li>
            Le paiement est traité par Stripe. Nous ne stockons jamais vos coordonnées bancaires.
          </li>
          <li>
            L'abonnement se renouvelle automatiquement chaque mois jusqu'à résiliation.
          </li>
          <li>
            Vous pouvez résilier à tout moment depuis votre espace client. La résiliation prend
            effet à la fin de la période déjà payée : le service reste accessible jusque-là, et
            aucun prélèvement supplémentaire n'est effectué ensuite.
          </li>
          <li>
            Les périodes entamées ne font pas l'objet d'un remboursement au prorata, sauf
            indisponibilité prolongée du service qui nous serait imputable.
          </li>
        </ul>
        <p>
          S'agissant d'un contrat conclu entre professionnels, le droit de rétractation de quatorze
          jours prévu pour les consommateurs ne s'applique pas.
        </p>

        <h2>5. Usage raisonnable de l'intelligence artificielle</h2>
        <p>
          Chaque abonnement inclut une enveloppe mensuelle de traitement par intelligence
          artificielle (de l'ordre de 20 € de consommation par utilisateur et par mois). Cette
          enveloppe couvre très largement un usage commercial normal. Au-delà, les fonctions
          d'intelligence artificielle sont temporairement suspendues jusqu'au mois suivant, sans que
          vos données ni le reste de l'application ne soient affectés. Nous vous prévenons avant
          d'atteindre ce plafond, et il peut être relevé sur demande.
        </p>

        <h2>6. Vos obligations</h2>
        <p>Vous vous engagez à :</p>
        <ul>
          <li>
            respecter la réglementation applicable à la prospection commerciale, notamment le RGPD
            et les règles relatives aux communications électroniques : disposer d'une base légale
            pour contacter vos prospects, les informer, et honorer immédiatement toute demande de
            désinscription ou d'opposition ;
          </li>
          <li>
            n'utiliser Meet Aaron ni pour de l'envoi massif non sollicité (spam), ni pour des
            contenus trompeurs, illicites, diffamatoires ou portant atteinte aux droits d'autrui ;
          </li>
          <li>
            ne pas importer de données de prospects que vous n'êtes pas en droit de traiter ;
          </li>
          <li>
            relire les messages proposés par Aaron avant leur envoi, et vérifier les montants et
            engagements figurant dans les devis générés ;
          </li>
          <li>
            ne pas tenter de contourner les limitations techniques du service, ni d'accéder aux
            données d'autres clients.
          </li>
        </ul>
        <p>
          Les emails partent depuis votre propre boîte et sous votre identité : vous en êtes
          l'expéditeur au sens juridique, et le responsable de traitement des données de vos
          prospects. Nous agissons comme sous-traitant pour votre compte.
        </p>

        <h2>7. Accès à votre messagerie et à votre agenda</h2>
        <p>
          Meet Aaron ne fonctionne qu'avec les accès que vous autorisez explicitement lors de la
          connexion de votre compte Google ou Microsoft. Ces accès servent uniquement à fournir les
          fonctions que vous avez activées : lire les réponses de vos prospects, envoyer des emails
          en votre nom, et créer ou consulter des rendez-vous.
        </p>
        <p>
          L'utilisation et le transfert des informations reçues des API Google respectent la{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , y compris ses exigences d'utilisation limitée (<em>Limited Use</em>). Concrètement :
          ces données ne sont jamais vendues, jamais utilisées à des fins publicitaires, jamais
          utilisées pour entraîner un modèle d'intelligence artificielle généraliste, et ne sont
          lues par un humain que si vous nous le demandez pour résoudre un problème, si la loi
          l'exige, ou pour des raisons de sécurité.
        </p>
        <p>
          Vous pouvez révoquer ces accès à tout moment depuis l'écran « Connexions » de
          l'application, ou directement depuis les paramètres de sécurité de votre compte Google ou
          Microsoft.
        </p>

        <h2>8. Disponibilité du service</h2>
        <p>
          Nous mettons tout en œuvre pour assurer un service continu, sans pouvoir garantir une
          disponibilité ininterrompue. Le service peut être suspendu temporairement pour
          maintenance, ou perturbé par une défaillance de l'un de nos prestataires techniques
          (hébergement, messagerie, fournisseur d'intelligence artificielle).
        </p>

        <h2>9. Responsabilité</h2>
        <p>
          Meet Aaron est un outil d'aide à la vente. Nous ne garantissons aucun résultat commercial,
          aucun taux de réponse, ni l'exactitude des contenus générés par l'intelligence
          artificielle, qui doivent être relus avant usage.
        </p>
        <p>
          Notre responsabilité ne saurait être engagée pour les conséquences des messages que vous
          choisissez d'envoyer, ni pour les dommages indirects tels qu'une perte de chiffre
          d'affaires, de clientèle ou de données imputable à un tiers. En tout état de cause, notre
          responsabilité est limitée aux sommes que vous nous avez versées au cours des douze mois
          précédant le fait générateur.
        </p>

        <h2>10. Propriété intellectuelle</h2>
        <p>
          L'application, sa marque et son code restent notre propriété exclusive. Votre abonnement
          vous confère un droit d'usage personnel, non exclusif et non transférable, pour la durée
          de l'abonnement.
        </p>
        <p>
          Vos données, vos documents et les contenus générés pour votre compte vous appartiennent.
          Nous ne les utilisons pas pour entraîner des modèles d'intelligence artificielle.
        </p>

        <h2>11. Données personnelles</h2>
        <p>
          Le traitement de vos données et de celles de vos prospects est détaillé dans notre{' '}
          <a href="/privacy">politique de confidentialité</a>, qui fait partie intégrante des
          présentes conditions.
        </p>

        <h2>12. Suspension et fermeture du compte</h2>
        <p>
          Nous pouvons suspendre ou fermer un compte en cas de manquement grave aux présentes
          conditions, notamment en cas d'envois abusifs ou d'usage illicite, après vous en avoir
          informé sauf urgence. Vous pouvez de votre côté demander la suppression de votre compte et
          des données associées à tout moment depuis l'application ou en nous écrivant.
        </p>

        <h2>13. Évolution des conditions</h2>
        <p>
          Ces conditions peuvent évoluer avec le service. Toute modification substantielle vous sera
          notifiée par email au moins trente jours avant son entrée en vigueur. Si elle ne vous
          convient pas, vous pouvez résilier sans frais avant cette date.
        </p>

        <h2>14. Droit applicable</h2>
        <p>
          Les présentes conditions sont soumises au droit français. En cas de litige, nous
          chercherons d'abord une solution amiable ; à défaut, les tribunaux français seront
          compétents.
        </p>

        <h2>15. Contact</h2>
        <p>
          Pour toute question sur ces conditions :{' '}
          <a href="mailto:aaron@meetaaron.app">aaron@meetaaron.app</a>.
        </p>

        <p className="footer-note">
          Voir aussi notre <a href="/privacy">politique de confidentialité</a>.
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
