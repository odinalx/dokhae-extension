# Fiche Chrome Web Store · français (langue par défaut)

## Nom

Dokhae

## Description courte (132 caractères max)

Lis tes webtoons en coréen : encadre une bulle, comprends chaque mot et garde-le dans ton deck Dokhae.

## Description complète

Dokhae (독해, « lecture ») t'aide à lire tes webtoons en coréen, directement sur la page.

Comment ça marche :
1. Clique sur l'icône Dokhae, puis sur « Scanner une bulle ».
2. Encadre une bulle : Dokhae lit le texte coréen de la zone choisie.
3. La phrase s'affiche mot à mot, chaque mot souligné selon sa nature (nom, verbe, particule…).
4. Touche un mot : traduction, forme du dictionnaire, registre, phrase d'exemple et prononciation.
5. « Ajouter au deck » : le mot rejoint tes révisions sur dokhae.fr (répétition espacée).

Tu peux aussi sélectionner du texte coréen sur n'importe quelle page, puis faire un clic droit et choisir « Analyser avec Dokhae », ou cliquer sur « Analyser la sélection » dans la fenêtre de l'extension.

Chaque mot ajouté garde un lien vers la page où tu l'as trouvé : dans tes révisions, tu retrouves le chapitre d'un clic.

Ce qui compte pour toi :
• La lecture de l'image se fait sur ton ordinateur. Seul le texte reconnu part vers Dokhae pour l'analyse.
• Dokhae ne lit que l'onglet où tu l'appelles, au moment où tu l'appelles. Rien ne tourne en fond sur les sites que tu visites.
• Pas de publicité, aucune revente de données.
• Tes mots peuvent aussi partir dans Anki (module AnkiConnect), si tu préfères.

Abonnement requis : l'extension s'utilise avec un compte Dokhae abonné. Pour un nouveau compte, le premier mois est à 2,99 €. Formules et conditions sur https://dokhae.fr/pricing

Connexion en un clic : « Connecter mon compte » ouvre dokhae.fr et relie l'extension à ton compte, sans copier de code.

## Catégorie

Éducation

## Langue

Français

## Objectif unique (Single purpose)

Aider à lire le coréen dans les webtoons et sur le web : l'extension lit le texte coréen d'une zone ou d'une sélection choisie par l'utilisateur, l'explique mot à mot, et enregistre les mots choisis dans son deck de révision Dokhae.

## Justification des autorisations

| Autorisation | Pourquoi |
|---|---|
| `activeTab` | Quand l'utilisateur clique sur « Scanner une bulle » ou sur le menu contextuel, l'extension accède à l'onglet actif, et seulement à lui, pour afficher le cadre de sélection et capturer la zone visible choisie. |
| `scripting` | Injecter le panneau Dokhae dans l'onglet actif à la demande (sous `activeTab`), au lieu de déclarer un script sur tous les sites. |
| `storage` | Garder les réglages (jeton d'accès Dokhae, identifiant aléatoire de cette installation, deck choisi, option Anki), l'état de l'abonnement en cache et les mots en attente d'envoi. |
| `offscreen` | Faire tourner la reconnaissance de texte (Tesseract, WebAssembly) dans un Web Worker et lire l'audio de prononciation. Un service worker ne peut faire ni l'un ni l'autre. |
| `contextMenus` | L'entrée « Analyser avec Dokhae » du clic droit sur du texte sélectionné. |
| `https://dokhae.fr/*` | L'API Dokhae : vérification du compte, analyse du texte reconnu, enregistrement des mots dans le deck. Le script de connexion en un clic tourne uniquement sur `https://dokhae.fr/connect-extension`. |
| `https://translate.google.com/*` | Voix de secours pour la prononciation (synthèse vocale Google), quand le dictionnaire n'a pas d'enregistrement. |
| `https://ko.dict.naver.com/*` | Trouver l'enregistrement audio d'un mot dans le dictionnaire coréen de Naver. |
| `https://dict-dn.pstatic.net/*` | Télécharger ce fichier audio (serveur de fichiers du dictionnaire Naver). |
| `http://127.0.0.1:8765/*`, `http://localhost:8765/*` | AnkiConnect, sur l'ordinateur de l'utilisateur : utilisé uniquement si l'utilisateur choisit Anki comme destination de ses cartes. |

Code distant : **non**. Tout le code est dans le paquet (le modèle de reconnaissance coréen compris).

## Onglet « Confidentialité » (pratiques relatives aux données)

Données collectées (cases à cocher) :
- **Informations permettant d'identifier personnellement l'utilisateur** : oui, l'adresse e-mail du compte Dokhae, reçue du site pour afficher le compte connecté.
- **Informations d'authentification** : oui, le jeton d'accès Dokhae (`sori_…`), stocké localement et envoyé uniquement à dokhae.fr.
- **Contenu du site Web** : oui, le texte coréen reconnu dans la zone choisie (ou le texte sélectionné) est envoyé à dokhae.fr pour l'analyse. Les mots écoutés sont envoyés au dictionnaire Naver ou à Google pour la prononciation.
- **Historique Web** : oui, par prudence : quand l'utilisateur ajoute un mot à son deck, l'adresse de la page où il l'a trouvé est enregistrée avec la carte, pour qu'il puisse y revenir. Rien n'est envoyé tant qu'il n'ajoute pas de mot.
- Santé, finances, communications personnelles, localisation, activité de l'utilisateur : **non**.

Précisions à reprendre dans les champs libres :
- La capture de la zone choisie est traitée localement (reconnaissance de texte sur l'ordinateur) : l'image ne quitte pas l'appareil.
- Les mots ajoutés au deck (mot, traduction, phrase d'exemple, adresse de la page d'origine) sont enregistrés sur le compte Dokhae de l'utilisateur, qui peut modifier ou effacer cette adresse.
- Aucune donnée n'est vendue, ni utilisée pour de la publicité, ni pour évaluer la solvabilité.

Attestations à cocher :
- Je ne vends ni ne transfère les données des utilisateurs à des tiers, en dehors des cas d'utilisation approuvés.
- Je n'utilise pas les données à des fins sans rapport avec l'objectif unique de l'article.
- Je n'utilise pas les données pour déterminer la solvabilité ou à des fins de prêt.

## Liens

- Règles de confidentialité : https://dokhae.fr/privacy
- Site : https://dokhae.fr
- Assistance : contact@dokhae.fr

## Visuels (store/assets/)

- Icône : `icon-128.png`
- Captures 1280 × 800, dans cet ordre : `screenshot-1-capture.png`, `screenshot-2-panel.png`, `screenshot-3-word.png`, `screenshot-4-deck.png`, `screenshot-5-popup.png`
- Petite vignette promotionnelle 440 × 280 : `promo-small-440x280.png`
