# Boutique Shinobi

Une boutique shinobi jouable au clavier ou au téléphone, pour gérer l'argent (Ryo), les
achats d'équipement et l'inventaire persistant de plusieurs personnages, sur la base du
supplément `boutique_shinobi_catalogue.md` (compatible avec le système D10 / Succès du
livre de base Shinobi-Naruto-JDR).

Application 100 % statique : HTML/CSS/JavaScript vanilla, sans framework, sans étape de
build, sans dépendance npm, sans serveur. Aucune donnée ne quitte l'appareil : tout est
stocké dans le `localStorage` du navigateur.

## Fonctionnalités

- **Profils multiples** : créer, renommer, dupliquer, supprimer des personnages (Genin /
  Chûnin / Jônin), chacun avec son solde de Ryo, son inventaire et son historique de
  transactions.
- **Boutique** : parcourir les 10 catégories du catalogue (A à J), filtrer par catégorie,
  rareté, type ou nom, afficher/masquer les objets hors-commerce, et un « mode Conteur »
  pour révéler les objets réservés (substances restreintes, objets d'intrigue).
- **Fiche objet** : détail complet (rareté, prix, conditions d'utilisation, effet chiffré),
  accessible en cliquant un objet ou via une URL du type `#/item/kunai-explosif`.
- **Légende des raretés** : le tableau ★ à ★★★★★ du catalogue, avec où trouver l'objet et
  ce que ça représente.
- **Inventaire** : objets possédés par profil actif, groupés par catégorie, avec
  consommation ou revente à 50 % du prix d'achat, et la valeur totale de l'inventaire.
- **Missions & paie** : calculateur de rang de mission (D à S) avec récompense par défaut
  et fourchette usuelle, part du village (15 %), répartition entre ninjas participants
  (bonus 1,5 part pour le chef d'équipe en option), crédit en un clic vers un ou plusieurs
  profils, plus un formulaire d'ajustement manuel (décision du conteur).
- **Export / import de profil** : téléchargez un profil en fichier `.json` depuis la page
  Profils, et rechargez-le plus tard sur un autre appareil ou navigateur (voir ci-dessous).

## Lancer l'application en local

Ouvrez simplement `index.html` (double-clic, ou glisser-déposer dans un onglet du
navigateur). C'est tout — pas de serveur, pas d'installation, pas de terminal. Le
JavaScript est écrit en scripts classiques (pas de modules ES), donc rien n'empêche de
l'ouvrir directement depuis le disque (`file://`).

Aucune connexion internet n'est requise, même au premier chargement : aucune police, aucun
script ni aucune feuille de style externe n'est chargé depuis un CDN.

## Publier l'application

Comme c'est un dossier de fichiers statiques, la publier consiste juste à héberger ce
dossier tel quel (GitHub Pages, Netlify, Cloudflare Pages, un simple hébergement mutualisé,
etc.). Il n'y a rien à construire, rien à configurer côté serveur, et aucune base de
données à gérer : uploadez le dossier, c'est fini.

## Persistance des données

Tout est stocké dans le `localStorage` du navigateur, sous des clés préfixées
`shinobi-shop:v1:...` (profils, profil actif, réglages d'affichage). Rien n'est envoyé sur
le réseau — il n'y a ni backend ni base de données. Les données restent donc propres à un
navigateur et un appareil : si vous jouez depuis plusieurs appareils, chacun aura son
propre état local.

### Transférer un profil vers un autre appareil

Comme les données restent dans le navigateur, il n'y a pas de synchronisation automatique
entre appareils. Pour jouer le même personnage ailleurs :

1. Sur l'appareil d'origine, allez dans **Profils**, repérez la carte du personnage et
   cliquez sur **Exporter** — un fichier `boutique-shinobi-<nom>.json` est téléchargé.
2. Transférez ce fichier vers l'autre appareil (clé USB, e-mail, cloud, etc.).
3. Sur l'autre appareil, ouvrez l'application, allez dans **Profils**, cliquez sur
   **Importer un profil** et sélectionnez le fichier.
4. Si un profil avec le même identifiant existe déjà à cet endroit, l'application demande
   s'il faut **remplacer** la version locale (écrase solde/inventaire/historique par la
   version importée) ou **importer comme copie** (crée un second profil distinct).

Le fichier exporté contient tout le profil (solde, inventaire, historique) mais rien
d'autre — pas les autres profils, pas les réglages d'affichage.

### Réinitialiser les données

Pour repartir de zéro (tout supprimer : profils, soldes, inventaires, historiques,
réglages) :

- Dans les outils de développement du navigateur (F12) → onglet **Application**
  (Chrome/Edge) ou **Stockage** (Firefox) → **Stockage local** → supprimez les entrées
  commençant par `shinobi-shop:`.
- Ou, plus simplement, ouvrez la console du navigateur sur la page de l'application et
  exécutez :
  ```js
  Object.keys(localStorage)
    .filter((key) => key.startsWith("shinobi-shop"))
    .forEach((key) => localStorage.removeItem(key));
  location.reload();
  ```

## Structure du projet

Voir [STRUCTURE.md](STRUCTURE.md) pour l'architecture détaillée : arborescence commentée,
flux de données, schémas des modèles de données, convention des clés `localStorage` et
stratégie de version de schéma, et comment ajouter un objet ou une vue.
