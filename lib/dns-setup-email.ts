// lib/dns-setup-email.ts
//
// L'EMAIL QUI FAIT LE REGLAGE DNS A LA PLACE DE L'UTILISATEUR — ou presque.
//
// Demande d'Alex (A_FAIRE.docx, 26/09/2026) : « Il faut faire le plus
// automatique possible. Donc probablement envoyer un email pas a pas et
// demander a l'utilisateur de faire les etapes. Lui conseiller d'utiliser une
// IA pour l'assister, ou alors il peut utiliser le chat aaron pour cela. »
//
// Le constat qui a declenche cette demande est juste et il faut l'ecrire :
// un artisan, un commercial ou un dirigeant de PME n'ira JAMAIS creer un
// enregistrement TXT dans une zone DNS parce qu'un badge orange s'affiche
// dans un ecran « Connexions » qu'il ne rouvrira plus jamais. Une
// notification push de deux lignes ne suffit pas non plus : elle dit qu'il y
// a un probleme, pas comment le regler, et elle disparait.
//
// Ce que cet email apporte et que l'ecran Connexions n'apportera jamais :
//   - il ARRIVE chez lui, il reste dans sa boite, il se retrouve par
//     recherche trois semaines plus tard ;
//   - il contient les valeurs EXACTES a copier-coller, deja calculees pour
//     son fournisseur (lib/email-deliverability.ts) ;
//   - il nomme son hebergeur DNS et donne le lien direct vers la bonne page ;
//   - il est TRANSFERABLE : l'utilisateur qui ne veut pas y toucher le
//     transfere a son webmaster, et tout y est ;
//   - il est COLLABLE dans le chat Aaron ou dans n'importe quel assistant IA,
//     qui prendra le relais clic par clic.
//
// Limite assumee, et il faut la dire franchement : on ne peut PAS generer la
// valeur DKIM a la place de l'utilisateur. Cette valeur est une cle publique
// que seul Google (console d'administration) ou Microsoft (portail Defender)
// peut produire pour son domaine — personne d'autre, nous compris, n'y a
// acces. L'email donne donc pour DKIM le chemin exact vers le bouton qui
// affiche la cle, et non une valeur a recopier. SPF et DMARC, eux, sont
// fournis prets a coller.

import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  checkDomainHealth,
  checkDkim,
  detectDnsProvider,
  isConsumerDomain,
  suggestedSpfRecord,
  suggestedDmarcRecord,
} from '@/lib/email-deliverability';
import { normalizeLocale } from '@/lib/locale-instruction';

export type MailProvider = 'google' | 'microsoft' | 'imap';

export interface DnsSetupNeeds {
  domain: string;
  provider: MailProvider;
  spfMissing: boolean;
  dkimMissing: boolean;
  dmarcMissing: boolean;
  spfRecord: string | null;
  dmarcRecord: string;
  dnsHost: { name: string; recordsUrl: string } | null;
}

interface Strings {
  subject: (domain: string) => string;
  hello: (firstName: string) => string;
  intro: (domain: string) => string;
  effort: string;
  whereTitle: string;
  hostKnown: (name: string, url: string) => string;
  hostUnknown: string;
  whatTitle: string;
  nameLabel: string;
  typeLabel: string;
  valueLabel: string;
  spfTitle: string;
  spfExisting: (include: string) => string;
  dkimTitle: string;
  dkimGoogle: string;
  dkimMicrosoft: (domain: string) => string;
  dkimImap: (domain: string) => string;
  dmarcTitle: string;
  dmarcWhy: string;
  stepsTitle: string;
  steps: string[];
  delegateTitle: string;
  delegateForward: string;
  delegateChat: string;
  delegateAi: string;
  closing: (domain: string) => string;
  signature: string;
}

// Les sept langues de l'application (lib/i18n.js). Volontairement dans ce
// fichier plutot que dans i18n.js : i18n.js est un dictionnaire d'INTERFACE
// charge cote client, aucune route serveur ne l'importe (voir l'en-tete de
// lib/locale-instruction.ts qui documente la meme separation).
const STRINGS: Record<string, Strings> = {
  fr: {
    subject: (d) => `Un réglage à faire sur ${d} avant que je commence à prospecter`,
    hello: (n) => `Bonjour${n ? ' ' + n : ''},`,
    intro: (d) =>
      `C'est Aaron. Avant d'écrire à tes prospects en ton nom, il me manque un réglage sur ${d}. ` +
      `Sans lui, tes emails partent quand même mais ils ont beaucoup plus de risques de tomber dans les indésirables — et un email de prospection en indésirable ne sert à rien.`,
    effort: `Compte 10 minutes, une seule fois, et rien à installer.`,
    whereTitle: `OÙ ALLER`,
    hostKnown: (name, url) => `Ton domaine est géré chez ${name} : ${url}`,
    hostUnknown: `Connecte-toi chez l'entreprise où tu as acheté ton nom de domaine (OVH, Gandi, GoDaddy, Ionos, Wix...), puis cherche « DNS », « Zone DNS » ou « Enregistrements ».`,
    whatTitle: `CE QU'IL FAUT CRÉER`,
    nameLabel: `Nom / Hôte`,
    typeLabel: `Type`,
    valueLabel: `Valeur`,
    spfTitle: `SPF — indispensable (sans lui je ne peux pas envoyer du tout)`,
    spfExisting: (inc) =>
      `Si une ligne commençant par « v=spf1 » existe DÉJÀ, ne la double pas : ajoute seulement « ${inc} » à l'intérieur, juste avant le « ~all ».`,
    dkimTitle: `DKIM — la signature de tes emails (c'est elle qui pèse le plus)`,
    dkimGoogle:
      `Google fabrique cette clé pour toi, on ne peut pas la deviner à ta place. Va sur admin.google.com > Applications > Google Workspace > Gmail > « Authentifier les e-mails », choisis ton domaine et clique sur « Générer un nouvel enregistrement ». Google t'affiche alors un Nom et une Valeur : ce sont ces deux-là que tu recopies chez ton hébergeur, puis tu reviens cliquer sur « Démarrer l'authentification ».`,
    dkimMicrosoft: (d) =>
      `Microsoft ne signe jamais automatiquement un domaine personnalisé — c'est la cause la plus fréquente d'emails en indésirable sur Outlook. Va sur security.microsoft.com > Politiques et règles > Règles de menace > DKIM, choisis ${d}, active l'option : Microsoft affiche alors deux enregistrements CNAME à créer chez ton hébergeur. Crée-les, attends une heure, puis reviens activer.`,
    dkimImap: (d) =>
      `Demande à l'hébergeur de ta messagerie d'activer la signature DKIM sur ${d} (une phrase suffit : « merci d'activer DKIM sur mon domaine »). Il te donnera un Nom et une Valeur à créer chez ton hébergeur DNS.`,
    dmarcTitle: `DMARC — recommandé`,
    dmarcWhy: `Il indique aux messageries quoi faire d'un email qui usurperait ton domaine, et tu reçois un rapport hebdomadaire sur ta propre adresse.`,
    stepsTitle: `COMMENT FAIRE, ÉTAPE PAR ÉTAPE`,
    steps: [
      `Ouvre le lien ci-dessus et connecte-toi.`,
      `Cherche « DNS », « Zone DNS » ou « Enregistrements ».`,
      `Clique sur « Ajouter un enregistrement ».`,
      `Recopie exactement le Nom, le Type et la Valeur indiqués plus haut — par copier-coller, jamais à la main : un espace en trop et l'enregistrement ne compte pas.`,
      `Enregistre. Compte jusqu'à une heure avant que ce soit pris en compte partout.`,
    ],
    delegateTitle: `SI TU PRÉFÈRES NE PAS LE FAIRE TOI-MÊME`,
    delegateForward: `Transfère cet email à la personne qui s'occupe de ton site ou de ton informatique : tout ce qu'il lui faut est dedans.`,
    delegateChat: `Ou colle cet email dans le chat Aaron, dans l'application : je te guide clic par clic et je réponds à tes questions au fur et à mesure.`,
    delegateAi: `Ou colle-le dans l'assistant IA que tu utilises déjà — il a tout ce qu'il faut pour te guider.`,
    closing: (d) =>
      `Je revérifie ${d} tout seul toutes les 24 heures. Dès que c'est en place, je te le confirme et je reprends la prospection : tu n'as rien d'autre à faire, et surtout rien à me signaler.`,
    signature: `Aaron\nTon assistant commercial`,
  },
  en: {
    subject: (d) => `One setting to fix on ${d} before I start prospecting`,
    hello: (n) => `Hi${n ? ' ' + n : ''},`,
    intro: (d) =>
      `This is Aaron. Before I email your prospects on your behalf, one setting is missing on ${d}. ` +
      `Without it your emails still go out, but they are far more likely to land in spam — and a prospecting email in the spam folder is worth nothing.`,
    effort: `It takes about 10 minutes, once, and there is nothing to install.`,
    whereTitle: `WHERE TO GO`,
    hostKnown: (name, url) => `Your domain is managed at ${name}: ${url}`,
    hostUnknown: `Sign in wherever you bought your domain name (GoDaddy, Namecheap, Cloudflare, OVH, Wix...), then look for "DNS", "DNS zone" or "Records".`,
    whatTitle: `WHAT TO CREATE`,
    nameLabel: `Name / Host`,
    typeLabel: `Type`,
    valueLabel: `Value`,
    spfTitle: `SPF — required (without it I cannot send at all)`,
    spfExisting: (inc) =>
      `If a line starting with "v=spf1" ALREADY exists, do not add a second one: just insert "${inc}" inside it, right before the "~all".`,
    dkimTitle: `DKIM — the signature on your emails (this is the one that counts most)`,
    dkimGoogle:
      `Google generates this key for you — nobody else, us included, can produce it. Go to admin.google.com > Apps > Google Workspace > Gmail > "Authenticate email", pick your domain and click "Generate new record". Google then shows you a Name and a Value: copy those two to your DNS host, then come back and click "Start authentication".`,
    dkimMicrosoft: (d) =>
      `Microsoft never signs a custom domain automatically — this is the single most common reason emails land in the Outlook junk folder. Go to security.microsoft.com > Policies & rules > Threat policies > DKIM, pick ${d} and switch it on: Microsoft then shows two CNAME records to create at your DNS host. Create them, wait an hour, then switch it on again.`,
    dkimImap: (d) =>
      `Ask your email host to enable DKIM signing on ${d} (one sentence is enough: "please enable DKIM on my domain"). They will give you a Name and a Value to create at your DNS host.`,
    dmarcTitle: `DMARC — recommended`,
    dmarcWhy: `It tells mail providers what to do with an email impersonating your domain, and you get a weekly report at your own address.`,
    stepsTitle: `STEP BY STEP`,
    steps: [
      `Open the link above and sign in.`,
      `Look for "DNS", "DNS zone" or "Records".`,
      `Click "Add record".`,
      `Copy the Name, Type and Value above exactly — paste them, never retype: one extra space and the record does not count.`,
      `Save. Allow up to an hour before it takes effect everywhere.`,
    ],
    delegateTitle: `IF YOU WOULD RATHER NOT DO IT YOURSELF`,
    delegateForward: `Forward this email to whoever looks after your website or your IT: everything they need is in it.`,
    delegateChat: `Or paste this email into the Aaron chat inside the app: I will walk you through it click by click and answer your questions as they come.`,
    delegateAi: `Or paste it into the AI assistant you already use — it has everything it needs to guide you.`,
    closing: (d) =>
      `I re-check ${d} on my own every 24 hours. As soon as it is in place I will confirm it and resume prospecting: nothing else to do, and nothing to tell me.`,
    signature: `Aaron\nYour sales assistant`,
  },
  de: {
    subject: (d) => `Eine Einstellung an ${d}, bevor ich mit der Akquise beginne`,
    hello: (n) => `Hallo${n ? ' ' + n : ''},`,
    intro: (d) =>
      `hier ist Aaron. Bevor ich in Ihrem Namen Ihre Interessenten anschreibe, fehlt eine Einstellung an ${d}. ` +
      `Ohne sie gehen Ihre E-Mails zwar raus, landen aber deutlich häufiger im Spam — und eine Akquise-E-Mail im Spam-Ordner bringt nichts.`,
    effort: `Rechnen Sie mit 10 Minuten, einmalig, und es muss nichts installiert werden.`,
    whereTitle: `WOHIN`,
    hostKnown: (name, url) => `Ihre Domain wird bei ${name} verwaltet: ${url}`,
    hostUnknown: `Melden Sie sich dort an, wo Sie Ihren Domainnamen gekauft haben (IONOS, Strato, GoDaddy, Cloudflare, Wix...), und suchen Sie nach "DNS", "DNS-Zone" oder "Einträge".`,
    whatTitle: `WAS ANZULEGEN IST`,
    nameLabel: `Name / Host`,
    typeLabel: `Typ`,
    valueLabel: `Wert`,
    spfTitle: `SPF — zwingend erforderlich (ohne ihn kann ich gar nicht senden)`,
    spfExisting: (inc) =>
      `Wenn es BEREITS eine Zeile gibt, die mit "v=spf1" beginnt, legen Sie keine zweite an: fügen Sie nur "${inc}" darin ein, direkt vor dem "~all".`,
    dkimTitle: `DKIM — die Signatur Ihrer E-Mails (sie wiegt am schwersten)`,
    dkimGoogle:
      `Diesen Schlüssel erzeugt Google für Sie — niemand sonst, wir eingeschlossen, kann das. Gehen Sie zu admin.google.com > Apps > Google Workspace > Gmail > "E-Mail authentifizieren", wählen Sie Ihre Domain und klicken Sie auf "Neuen Eintrag generieren". Google zeigt Ihnen dann einen Namen und einen Wert: diese beiden übertragen Sie zu Ihrem DNS-Anbieter, danach kehren Sie zurück und klicken auf "Authentifizierung starten".`,
    dkimMicrosoft: (d) =>
      `Microsoft signiert eine eigene Domain nie automatisch — das ist die häufigste Ursache dafür, dass E-Mails im Outlook-Junk-Ordner landen. Gehen Sie zu security.microsoft.com > Richtlinien und Regeln > Bedrohungsrichtlinien > DKIM, wählen Sie ${d} und aktivieren Sie es: Microsoft zeigt dann zwei CNAME-Einträge, die Sie bei Ihrem DNS-Anbieter anlegen. Legen Sie sie an, warten Sie eine Stunde, und aktivieren Sie erneut.`,
    dkimImap: (d) =>
      `Bitten Sie Ihren E-Mail-Anbieter, die DKIM-Signatur für ${d} zu aktivieren (ein Satz reicht: "bitte DKIM für meine Domain aktivieren"). Sie erhalten einen Namen und einen Wert, die Sie bei Ihrem DNS-Anbieter anlegen.`,
    dmarcTitle: `DMARC — empfohlen`,
    dmarcWhy: `Er sagt den Mailanbietern, was mit einer E-Mail zu tun ist, die Ihre Domain vortäuscht, und Sie erhalten einen Wochenbericht an Ihre eigene Adresse.`,
    stepsTitle: `SCHRITT FÜR SCHRITT`,
    steps: [
      `Öffnen Sie den Link oben und melden Sie sich an.`,
      `Suchen Sie nach "DNS", "DNS-Zone" oder "Einträge".`,
      `Klicken Sie auf "Eintrag hinzufügen".`,
      `Übertragen Sie Name, Typ und Wert von oben genau — per Kopieren und Einfügen, nie von Hand: ein Leerzeichen zu viel und der Eintrag zählt nicht.`,
      `Speichern. Bis zu einer Stunde, bis es überall wirkt.`,
    ],
    delegateTitle: `WENN SIE ES NICHT SELBST MACHEN MÖCHTEN`,
    delegateForward: `Leiten Sie diese E-Mail an die Person weiter, die sich um Ihre Website oder Ihre IT kümmert: alles Notwendige steht darin.`,
    delegateChat: `Oder fügen Sie diese E-Mail in den Aaron-Chat in der App ein: ich führe Sie Klick für Klick und beantworte Ihre Fragen unterwegs.`,
    delegateAi: `Oder fügen Sie sie in den KI-Assistenten ein, den Sie schon nutzen — er hat alles, um Sie zu führen.`,
    closing: (d) =>
      `Ich prüfe ${d} von allein alle 24 Stunden. Sobald es steht, bestätige ich es und nehme die Akquise wieder auf: sonst ist nichts zu tun, und Sie müssen mir nichts melden.`,
    signature: `Aaron\nIhr Vertriebsassistent`,
  },
  it: {
    subject: (d) => `Un'impostazione da sistemare su ${d} prima che inizi a contattare`,
    hello: (n) => `Ciao${n ? ' ' + n : ''},`,
    intro: (d) =>
      `sono Aaron. Prima di scrivere ai tuoi potenziali clienti a tuo nome, manca un'impostazione su ${d}. ` +
      `Senza di essa le tue email partono comunque, ma rischiano molto più spesso di finire nello spam — e un'email di prospezione nello spam non serve a niente.`,
    effort: `Conta 10 minuti, una volta sola, e non c'è nulla da installare.`,
    whereTitle: `DOVE ANDARE`,
    hostKnown: (name, url) => `Il tuo dominio è gestito su ${name}: ${url}`,
    hostUnknown: `Accedi dove hai acquistato il tuo nome di dominio (Aruba, Register.it, GoDaddy, Cloudflare, Wix...), poi cerca "DNS", "Zona DNS" o "Record".`,
    whatTitle: `COSA CREARE`,
    nameLabel: `Nome / Host`,
    typeLabel: `Tipo`,
    valueLabel: `Valore`,
    spfTitle: `SPF — indispensabile (senza non posso inviare affatto)`,
    spfExisting: (inc) =>
      `Se esiste GIÀ una riga che inizia con "v=spf1", non aggiungerne una seconda: inserisci solo "${inc}" al suo interno, subito prima di "~all".`,
    dkimTitle: `DKIM — la firma delle tue email (è quella che pesa di più)`,
    dkimGoogle:
      `Questa chiave la genera Google per te — nessun altro, noi compresi, può produrla. Vai su admin.google.com > App > Google Workspace > Gmail > "Autentica email", scegli il tuo dominio e clicca su "Genera nuovo record". Google ti mostra un Nome e un Valore: copia questi due presso il tuo provider DNS, poi torna e clicca su "Avvia autenticazione".`,
    dkimMicrosoft: (d) =>
      `Microsoft non firma mai automaticamente un dominio personalizzato — è la causa più frequente delle email finite nella posta indesiderata di Outlook. Vai su security.microsoft.com > Criteri e regole > Criteri per le minacce > DKIM, scegli ${d} e attivalo: Microsoft mostra allora due record CNAME da creare presso il tuo provider DNS. Creali, attendi un'ora, poi riattiva.`,
    dkimImap: (d) =>
      `Chiedi al tuo provider di posta di attivare la firma DKIM su ${d} (basta una frase: "per favore attivate DKIM sul mio dominio"). Ti darà un Nome e un Valore da creare presso il tuo provider DNS.`,
    dmarcTitle: `DMARC — consigliato`,
    dmarcWhy: `Indica ai provider di posta cosa fare di un'email che finge di venire dal tuo dominio, e ricevi un rapporto settimanale sul tuo indirizzo.`,
    stepsTitle: `PASSO PER PASSO`,
    steps: [
      `Apri il link qui sopra e accedi.`,
      `Cerca "DNS", "Zona DNS" o "Record".`,
      `Clicca su "Aggiungi record".`,
      `Ricopia esattamente Nome, Tipo e Valore indicati sopra — con copia e incolla, mai a mano: uno spazio in più e il record non conta.`,
      `Salva. Conta fino a un'ora prima che sia attivo dappertutto.`,
    ],
    delegateTitle: `SE PREFERISCI NON FARLO DA SOLO`,
    delegateForward: `Inoltra questa email a chi si occupa del tuo sito o della tua informatica: c'è dentro tutto il necessario.`,
    delegateChat: `Oppure incolla questa email nella chat Aaron dentro l'applicazione: ti guido clic per clic e rispondo alle tue domande man mano.`,
    delegateAi: `Oppure incollala nell'assistente IA che usi già — ha tutto quello che serve per guidarti.`,
    closing: (d) =>
      `Ricontrollo ${d} da solo ogni 24 ore. Appena è a posto te lo confermo e riprendo la prospezione: non devi fare altro, e non devi segnalarmi niente.`,
    signature: `Aaron\nIl tuo assistente commerciale`,
  },
  es: {
    subject: (d) => `Un ajuste en ${d} antes de que empiece a prospectar`,
    hello: (n) => `Hola${n ? ' ' + n : ''},`,
    intro: (d) =>
      `soy Aaron. Antes de escribir a tus posibles clientes en tu nombre, falta un ajuste en ${d}. ` +
      `Sin él tus correos salen igualmente, pero tienen muchas más probabilidades de acabar en spam — y un correo de prospección en spam no sirve de nada.`,
    effort: `Cuenta 10 minutos, una sola vez, y no hay nada que instalar.`,
    whereTitle: `DÓNDE IR`,
    hostKnown: (name, url) => `Tu dominio está gestionado en ${name}: ${url}`,
    hostUnknown: `Entra donde compraste tu nombre de dominio (GoDaddy, Dondominio, Cloudflare, IONOS, Wix...) y busca "DNS", "Zona DNS" o "Registros".`,
    whatTitle: `QUÉ HAY QUE CREAR`,
    nameLabel: `Nombre / Host`,
    typeLabel: `Tipo`,
    valueLabel: `Valor`,
    spfTitle: `SPF — imprescindible (sin él no puedo enviar nada)`,
    spfExisting: (inc) =>
      `Si YA existe una línea que empieza por "v=spf1", no crees una segunda: añade solamente "${inc}" dentro de ella, justo antes del "~all".`,
    dkimTitle: `DKIM — la firma de tus correos (es la que más pesa)`,
    dkimGoogle:
      `Esta clave la genera Google para ti — nadie más, nosotros incluidos, puede producirla. Ve a admin.google.com > Aplicaciones > Google Workspace > Gmail > "Autenticar correo", elige tu dominio y pulsa "Generar registro nuevo". Google te muestra entonces un Nombre y un Valor: copia esos dos en tu proveedor DNS, y vuelve a pulsar "Iniciar autenticación".`,
    dkimMicrosoft: (d) =>
      `Microsoft nunca firma automáticamente un dominio propio — es la causa más frecuente de correos en la carpeta de no deseados de Outlook. Ve a security.microsoft.com > Políticas y reglas > Políticas de amenazas > DKIM, elige ${d} y actívalo: Microsoft muestra entonces dos registros CNAME que debes crear en tu proveedor DNS. Créalos, espera una hora y vuelve a activar.`,
    dkimImap: (d) =>
      `Pide a tu proveedor de correo que active la firma DKIM en ${d} (basta una frase: "activen DKIM en mi dominio, por favor"). Te dará un Nombre y un Valor para crear en tu proveedor DNS.`,
    dmarcTitle: `DMARC — recomendado`,
    dmarcWhy: `Indica a los proveedores de correo qué hacer con un mensaje que suplante tu dominio, y recibes un informe semanal en tu propia dirección.`,
    stepsTitle: `PASO A PASO`,
    steps: [
      `Abre el enlace de arriba e inicia sesión.`,
      `Busca "DNS", "Zona DNS" o "Registros".`,
      `Pulsa "Añadir registro".`,
      `Copia exactamente el Nombre, el Tipo y el Valor indicados arriba — con copiar y pegar, nunca a mano: un espacio de más y el registro no cuenta.`,
      `Guarda. Cuenta hasta una hora antes de que surta efecto en todas partes.`,
    ],
    delegateTitle: `SI PREFIERES NO HACERLO TÚ MISMO`,
    delegateForward: `Reenvía este correo a quien se encarga de tu web o de tu informática: dentro está todo lo necesario.`,
    delegateChat: `O pega este correo en el chat de Aaron dentro de la aplicación: te guío clic a clic y respondo a tus dudas sobre la marcha.`,
    delegateAi: `O pégalo en el asistente de IA que ya usas — tiene todo lo necesario para guiarte.`,
    closing: (d) =>
      `Vuelvo a comprobar ${d} por mi cuenta cada 24 horas. En cuanto esté listo te lo confirmo y retomo la prospección: no tienes que hacer nada más, ni avisarme.`,
    signature: `Aaron\nTu asistente comercial`,
  },
  pt: {
    subject: (d) => `Uma configuração a corrigir em ${d} antes de eu começar a prospetar`,
    hello: (n) => `Olá${n ? ' ' + n : ''},`,
    intro: (d) =>
      `sou o Aaron. Antes de escrever aos seus potenciais clientes em seu nome, falta uma configuração em ${d}. ` +
      `Sem ela os seus emails saem de qualquer forma, mas têm muito mais probabilidade de cair no spam — e um email de prospeção no spam não serve para nada.`,
    effort: `Conte 10 minutos, uma só vez, e não há nada para instalar.`,
    whereTitle: `ONDE IR`,
    hostKnown: (name, url) => `O seu domínio é gerido em ${name}: ${url}`,
    hostUnknown: `Entre onde comprou o seu nome de domínio (GoDaddy, Amen, Cloudflare, IONOS, Wix...) e procure "DNS", "Zona DNS" ou "Registos".`,
    whatTitle: `O QUE CRIAR`,
    nameLabel: `Nome / Host`,
    typeLabel: `Tipo`,
    valueLabel: `Valor`,
    spfTitle: `SPF — indispensável (sem ele não consigo enviar nada)`,
    spfExisting: (inc) =>
      `Se JÁ existir uma linha que começa por "v=spf1", não crie uma segunda: acrescente apenas "${inc}" dentro dela, imediatamente antes do "~all".`,
    dkimTitle: `DKIM — a assinatura dos seus emails (é a que pesa mais)`,
    dkimGoogle:
      `Esta chave é gerada pela Google para si — mais ninguém, nós incluídos, a pode produzir. Vá a admin.google.com > Aplicações > Google Workspace > Gmail > "Autenticar email", escolha o seu domínio e clique em "Gerar novo registo". A Google mostra-lhe então um Nome e um Valor: copie esses dois para o seu fornecedor de DNS e volte a clicar em "Iniciar autenticação".`,
    dkimMicrosoft: (d) =>
      `A Microsoft nunca assina automaticamente um domínio próprio — é a causa mais frequente de emails na pasta de lixo do Outlook. Vá a security.microsoft.com > Políticas e regras > Políticas de ameaças > DKIM, escolha ${d} e ative: a Microsoft mostra então dois registos CNAME a criar no seu fornecedor de DNS. Crie-os, espere uma hora e volte a ativar.`,
    dkimImap: (d) =>
      `Peça ao fornecedor do seu email para ativar a assinatura DKIM em ${d} (basta uma frase: "por favor ativem o DKIM no meu domínio"). Dar-lhe-á um Nome e um Valor a criar no seu fornecedor de DNS.`,
    dmarcTitle: `DMARC — recomendado`,
    dmarcWhy: `Indica aos fornecedores de email o que fazer com uma mensagem que finja vir do seu domínio, e recebe um relatório semanal no seu próprio endereço.`,
    stepsTitle: `PASSO A PASSO`,
    steps: [
      `Abra o link acima e inicie sessão.`,
      `Procure "DNS", "Zona DNS" ou "Registos".`,
      `Clique em "Adicionar registo".`,
      `Copie exatamente o Nome, o Tipo e o Valor indicados acima — por copiar e colar, nunca à mão: um espaço a mais e o registo não conta.`,
      `Guarde. Conte até uma hora antes de ter efeito em todo o lado.`,
    ],
    delegateTitle: `SE PREFERIR NÃO FAZER ISTO SOZINHO`,
    delegateForward: `Encaminhe este email à pessoa que trata do seu site ou da sua informática: está ali tudo o que ela precisa.`,
    delegateChat: `Ou cole este email no chat do Aaron dentro da aplicação: guio-o clique a clique e respondo às suas dúvidas pelo caminho.`,
    delegateAi: `Ou cole-o no assistente de IA que já usa — tem tudo o que precisa para o guiar.`,
    closing: (d) =>
      `Volto a verificar ${d} sozinho a cada 24 horas. Assim que estiver feito, confirmo-lhe e retomo a prospeção: não tem de fazer mais nada, nem de me avisar.`,
    signature: `Aaron\nO seu assistente comercial`,
  },
  nl: {
    subject: (d) => `Een instelling op ${d} voordat ik met prospectie begin`,
    hello: (n) => `Hallo${n ? ' ' + n : ''},`,
    intro: (d) =>
      `dit is Aaron. Voordat ik uw prospects namens u aanschrijf, ontbreekt een instelling op ${d}. ` +
      `Zonder die instelling gaan uw e-mails wel de deur uit, maar belanden ze veel vaker in de spam — en een prospectie-e-mail in de spammap levert niets op.`,
    effort: `Reken op 10 minuten, eenmalig, en er hoeft niets geïnstalleerd te worden.`,
    whereTitle: `WAAR NAARTOE`,
    hostKnown: (name, url) => `Uw domein wordt beheerd bij ${name}: ${url}`,
    hostUnknown: `Meld u aan waar u uw domeinnaam hebt gekocht (TransIP, Antagonist, GoDaddy, Cloudflare, Wix...) en zoek naar "DNS", "DNS-zone" of "Records".`,
    whatTitle: `WAT AAN TE MAKEN`,
    nameLabel: `Naam / Host`,
    typeLabel: `Type`,
    valueLabel: `Waarde`,
    spfTitle: `SPF — noodzakelijk (zonder kan ik helemaal niets versturen)`,
    spfExisting: (inc) =>
      `Als er AL een regel bestaat die met "v=spf1" begint, maak er dan geen tweede: voeg alleen "${inc}" daarin toe, net voor de "~all".`,
    dkimTitle: `DKIM — de ondertekening van uw e-mails (die weegt het zwaarst)`,
    dkimGoogle:
      `Deze sleutel maakt Google voor u aan — niemand anders, wij inbegrepen, kan dat. Ga naar admin.google.com > Apps > Google Workspace > Gmail > "E-mail authenticeren", kies uw domein en klik op "Nieuw record genereren". Google toont dan een Naam en een Waarde: kopieer die twee naar uw DNS-provider en klik daarna op "Authenticatie starten".`,
    dkimMicrosoft: (d) =>
      `Microsoft ondertekent een eigen domein nooit automatisch — dat is de meest voorkomende oorzaak van e-mails in de map ongewenste e-mail van Outlook. Ga naar security.microsoft.com > Beleid en regels > Bedreigingsbeleid > DKIM, kies ${d} en zet het aan: Microsoft toont dan twee CNAME-records die u bij uw DNS-provider aanmaakt. Maak ze aan, wacht een uur en zet het opnieuw aan.`,
    dkimImap: (d) =>
      `Vraag uw e-mailprovider om DKIM-ondertekening op ${d} aan te zetten (een zin is genoeg: "gelieve DKIM op mijn domein te activeren"). U krijgt een Naam en een Waarde om bij uw DNS-provider aan te maken.`,
    dmarcTitle: `DMARC — aanbevolen`,
    dmarcWhy: `Het vertelt e-mailproviders wat ze moeten doen met een bericht dat uw domein nabootst, en u ontvangt een weekrapport op uw eigen adres.`,
    stepsTitle: `STAP VOOR STAP`,
    steps: [
      `Open de link hierboven en meld u aan.`,
      `Zoek naar "DNS", "DNS-zone" of "Records".`,
      `Klik op "Record toevoegen".`,
      `Neem Naam, Type en Waarde hierboven exact over — kopieer en plak, nooit met de hand: een spatie te veel en het record telt niet.`,
      `Opslaan. Reken op maximaal een uur voordat het overal werkt.`,
    ],
    delegateTitle: `ALS U DIT LIEVER NIET ZELF DOET`,
    delegateForward: `Stuur deze e-mail door naar wie uw website of IT beheert: alles wat die persoon nodig heeft staat erin.`,
    delegateChat: `Of plak deze e-mail in de Aaron-chat in de app: ik loop het klik voor klik met u door en beantwoord uw vragen onderweg.`,
    delegateAi: `Of plak hem in de AI-assistent die u al gebruikt — die heeft alles om u te begeleiden.`,
    closing: (d) =>
      `Ik controleer ${d} zelf elke 24 uur opnieuw. Zodra het in orde is bevestig ik het en hervat ik de prospectie: u hoeft niets anders te doen en mij niets te melden.`,
    signature: `Aaron\nUw verkoopassistent`,
  },
};

// Corps en texte brut : lib/messaging.ts le convertit en HTML une ligne =
// un <div>, exactement comme le composeur Gmail. Pas de tableau ni de
// mise en forme riche donc — et c'est tant mieux : un email de reglage
// technique doit rester copiable-collable tel quel dans un chat ou dans un
// champ de formulaire DNS.
export function buildDnsSetupEmail(
  locale: string | null | undefined,
  firstName: string | null | undefined,
  needs: DnsSetupNeeds
): { subject: string; body: string } {
  const s = STRINGS[normalizeLocale(locale)] || STRINGS.fr;
  const parts: string[] = [];

  parts.push(s.hello((firstName || '').trim()));
  parts.push('');
  parts.push(s.intro(needs.domain));
  parts.push('');
  parts.push(s.effort);
  parts.push('');
  parts.push(s.whereTitle);
  parts.push(
    needs.dnsHost ? s.hostKnown(needs.dnsHost.name, needs.dnsHost.recordsUrl) : s.hostUnknown
  );
  parts.push('');
  parts.push(s.whatTitle);

  let n = 0;
  if (needs.spfMissing && needs.spfRecord) {
    n += 1;
    parts.push('');
    parts.push(`${n}) ${s.spfTitle}`);
    parts.push(`   ${s.nameLabel} : @`);
    parts.push(`   ${s.typeLabel} : TXT`);
    parts.push(`   ${s.valueLabel} : ${needs.spfRecord}`);
    // L'include seul, pour l'utilisateur qui a deja un SPF a completer.
    const include = needs.spfRecord.replace(/^v=spf1\s+/, '').replace(/\s+[~\-+?]all$/, '').trim();
    if (include) parts.push(`   ${s.spfExisting(include)}`);
  }

  if (needs.dkimMissing) {
    n += 1;
    parts.push('');
    parts.push(`${n}) ${s.dkimTitle}`);
    const dkimText =
      needs.provider === 'google'
        ? s.dkimGoogle
        : needs.provider === 'microsoft'
        ? s.dkimMicrosoft(needs.domain)
        : s.dkimImap(needs.domain);
    parts.push(`   ${dkimText}`);
  }

  if (needs.dmarcMissing) {
    n += 1;
    parts.push('');
    parts.push(`${n}) ${s.dmarcTitle}`);
    parts.push(`   ${s.nameLabel} : _dmarc`);
    parts.push(`   ${s.typeLabel} : TXT`);
    parts.push(`   ${s.valueLabel} : ${needs.dmarcRecord}`);
    parts.push(`   ${s.dmarcWhy}`);
  }

  parts.push('');
  parts.push(s.stepsTitle);
  s.steps.forEach((step, i) => parts.push(`${i + 1}. ${step}`));

  parts.push('');
  parts.push(s.delegateTitle);
  parts.push(`- ${s.delegateForward}`);
  parts.push(`- ${s.delegateChat}`);
  parts.push(`- ${s.delegateAi}`);

  parts.push('');
  parts.push(s.closing(needs.domain));
  parts.push('');
  parts.push(s.signature);

  return { subject: s.subject(needs.domain), body: parts.join('\n') };
}

// Calcule ce qui manque reellement sur le domaine d'une adresse connectee.
// Renvoie null quand il n'y a rien a demander (domaine grand public, ou
// SPF + DKIM + DMARC deja en place) : dans ce cas aucun email ne part, il
// n'y a rien de plus penible qu'un rappel pour un probleme deja regle.
export async function computeDnsSetupNeeds(
  email: string,
  provider: MailProvider,
  imapSpfInclude?: string | null
): Promise<DnsSetupNeeds | null> {
  const domain = (email.split('@')[1] || '').trim().toLowerCase();
  if (!domain || isConsumerDomain(domain)) return null;

  const [health, dkim, dnsHost] = await Promise.all([
    checkDomainHealth(domain),
    checkDkim(domain, provider),
    detectDnsProvider(domain),
  ]);

  if (health.spf.found && dkim.found && health.dmarc.found) return null;

  return {
    domain,
    provider,
    spfMissing: !health.spf.found,
    dkimMissing: !dkim.found,
    dmarcMissing: !health.dmarc.found,
    spfRecord: suggestedSpfRecord(provider, imapSpfInclude),
    dmarcRecord: suggestedDmarcRecord(email),
    dnsHost,
  };
}

// Envoie l'email d'accompagnement dans la boite du commercial lui-meme.
//
// `force` : declenche depuis un bouton « Renvoyer les instructions » de
// l'ecran Connexions. Sans lui, un seul envoi par connexion et par
// probleme — on ne harcele pas quelqu'un qui a decide d'attendre son
// informaticien (colonne oauth_connections.dns_setup_email_sent_at, voir
// migration_signature_multilingue_2026-09-26.sql).
export async function sendDnsSetupEmail(
  userId: string,
  opts?: { force?: boolean }
): Promise<{ sent: boolean; reason?: string; domain?: string }> {
  try {
    const { data: connections } = await supabaseAdmin
      .from('oauth_connections')
      .select('id, provider, provider_account_email')
      .eq('user_id', userId)
      .in('provider', ['google', 'microsoft', 'imap']);

    const connection =
      (connections || []).find((c: any) => c.provider === 'google') ||
      (connections || []).find((c: any) => c.provider === 'microsoft') ||
      (connections || []).find((c: any) => c.provider === 'imap');

    if (!connection) return { sent: false, reason: 'no_connection' };

    const email = String((connection as any).provider_account_email || '');
    if (!email.includes('@')) return { sent: false, reason: 'no_email' };

    if (!opts?.force) {
      const { data: sentRow, error: sentErr } = await supabaseAdmin
        .from('oauth_connections')
        .select('dns_setup_email_sent_at')
        .eq('id', (connection as any).id)
        .maybeSingle();
      // Colonne absente (migration pas encore passee) : on laisse passer
      // l'envoi plutot que de bloquer la fonctionnalite entiere, quitte a ce
      // qu'un rappel se repete une fois de trop.
      if (!sentErr && (sentRow as any)?.dns_setup_email_sent_at) {
        return { sent: false, reason: 'already_sent' };
      }
    }

    const needs = await computeDnsSetupNeeds(email, (connection as any).provider as MailProvider);
    if (!needs) return { sent: false, reason: 'nothing_to_fix' };

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('full_name, locale')
      .eq('id', userId)
      .maybeSingle();

    const firstName = String((user as any)?.full_name || '').trim().split(/\s+/)[0] || '';
    const { subject, body } = buildDnsSetupEmail((user as any)?.locale, firstName, needs);

    // Import differe : lib/messaging.ts importe lib/email-deliverability.ts,
    // qui est aussi importe ici — on evite toute chaine circulaire au
    // chargement du module.
    const { sendEmailForUser } = await import('./messaging');
    // Destinataire = le commercial lui-meme. sendEmailForUser le detecte
    // (toSelf) et n'y met donc ni libelle « Gere par Aaron » ni archivage :
    // cet email doit rester bien visible dans sa boite de reception.
    await sendEmailForUser(userId, email, subject, body, { emailType: 'transactional' });

    await supabaseAdmin
      .from('oauth_connections')
      .update({ dns_setup_email_sent_at: new Date().toISOString() })
      .eq('id', (connection as any).id);

    return { sent: true, domain: needs.domain };
  } catch (err: any) {
    console.error('[DNS] envoi des instructions impossible (non bloquant) :', err.message);
    return { sent: false, reason: 'error' };
  }
}
