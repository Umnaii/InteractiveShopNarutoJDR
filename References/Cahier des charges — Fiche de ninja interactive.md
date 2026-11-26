# Cahier des charges — Fiche de ninja interactive

Nov 22, 2026 · @Yerrce

Une nouvelle page du site du shop : la fiche de personnage de la campagne, rendue interactive. Elle reprend la fiche papier « ShinobiFichePerso.pdf » et applique les règles du livre « ShinobiNarutoJdr.pdf » (Malicia & Luna). Les deux PDF sont fournis avec ce document.

## 1. Contexte et contraintes techniques

La fiche vit sur le même site que le shop. Elle garde ses données dans le navigateur, sans serveur ni compte.

- **Avant de coder** : lire le code du shop existant. Réutiliser sa structure, son style et ses clés de stockage (bourse de ryos, objets achetés).
- **Stockage** : localStorage uniquement. Pas de base de données, pas d'API, pas de compte (choix du MJ : simplicité et sécurité). Sauvegarde automatique à chaque modification. Toutes les lectures et écritures sont protégées (try/catch) : si le stockage est indisponible, la fiche fonctionne quand même et affiche un avertissement.
- **Plusieurs fiches** : un navigateur peut contenir plusieurs fiches (un joueur avec deux personnages, le MJ qui teste). Sélecteur de fiche + créer, dupliquer, supprimer avec confirmation.
- **Export / import** : bouton « Exporter » qui télécharge la fiche en fichier .json, bouton « Importer » qui la recharge. C'est la seule façon de passer du téléphone au PC, et la sauvegarde en cas de cache vidé. Le dire clairement aux joueurs sur la page.
- **Écrans** : téléphone et PC.
  - Téléphone : une colonne, navigation par onglets, boutons tactiles d'au moins 44 px, aucun défilement horizontal.
  - PC : mise en page proche de la fiche papier, en plusieurs colonnes.
- **Style** : reprendre l'identité de la fiche papier et du shop : fond parchemin, coups de pinceau orange, spirales rouges, titres façon pinceau. Pied de page avec « Made by Malicia & Luna » et le lien lunart.fr.
- **Langue** : français, avec le vocabulaire exact de la fiche (Genin, Chûnin, Jônin, arts ninja, PA, PX, etc.).
- **Modifications** : libres. Le joueur peut toujours corriger un champ à la main, aucune validation du MJ n'est demandée.
- **Pages de référence du livre** : création p. 36 à 55, équipement p. 103-104, système de jeu p. 105 à 115.

## 2. Structure de la fiche

La fiche reprend tous les blocs du PDF, répartis en 7 onglets sur téléphone. Sur PC, les onglets peuvent s'afficher côte à côte comme sur la fiche papier. Un bouton flottant « Lancer les dés » reste accessible depuis n'importe quel onglet.

| Onglet | Contenu |
| --- | --- |
| Ninja | Identité : nom, surnom, description, joueur, clan, affinité, grade (Genin / Chûnin / Jônin), sexe, âge. Caractéristiques (Combat, Infiltration, Perception, Soutien) avec leurs traits. Arts ninja (Ninjutsu, Taijutsu, Genjutsu, Fûinjutsu, Kuchiyose). |
| Combat | Jauges énergie vitale et chakra, initiative, lanceur de d10. |
| Techniques | Tableau des techniques : nom, type, rang, niveau de maîtrise, élément éventuel, bouton « Lancer la technique ». |
| Éléments | La roue de la fiche papier : 5 éléments de base avec leur valeur, natures combinées autour, 2 emplacements Kekkei Genkai. |
| Aspects | 6 catégories × 2 champs de texte : Réputations, Clan, Personnalité, Hérédité, Liens, Autres. Boutons d'appel positif et négatif. |
| Sac | Bourse de ryos et équipement, partagés avec le shop. |
| Progression | PX et PA gagnés, dépensés, disponibles, historique des dépenses. |

Détails des champs :

- **Traits** : sous chaque caractéristique, autant de lignes de trait que sa valeur (Combat 3 = 3 traits). Chaque trait est un mot ou une courte expression libre.
- **Affinité** (identité) : remplie automatiquement depuis l'onglet Éléments.
- **Techniques de départ** déjà inscrites, comme sur la fiche : Henge – Métamorphose (Gen, rang E), Kawarimi – Substitution (Nin, rang E), Bunshin – Clone (Gen, rang E).
- **Type de technique** : abréviation de l'art ninja utilisé (Nin, Tai, Gen, Fûin, Kuchi). C'est cet art qui sert au jet.
- **Rang de technique** (fixé par le MJ) et coût en chakra, affiché automatiquement : E = 1, D = 2, C = 3, B = 4, A = 5, S = 6.
- **À ne pas reprendre** : la colonne « TH » et la mention « En création : +1 pt de chakra » de la fiche papier. Elles sont supprimées.

## 3. Mode création

Une nouvelle fiche s'ouvre en mode création. Le joueur choisit le grade, et la fiche applique les budgets de ce grade avec des compteurs « points restants ». Un interrupteur Création / Jeu permet de passer d'un mode à l'autre.

| Budget à la création | Genin | Chûnin | Jônin |
| --- | --- | --- | --- |
| Caractéristiques (points) | 8 | 12 | 16 |
| Arts ninja (points / max par art) | 12 / 6 | 24 / 9 | 48 / 12 |
| PA (techniques + chakra) | 6 | 18 | 30 |
| Chakra max de base | 20 | 30 | 40 |
| Énergie vitale max | 5 | 10 | 15 |
| Élément d'affinité | +1 | +2 | +3 |
| Seconde affinité | — | 0 | +1 |
| Élément faible | −2 | −2 | −2 |
| Autres éléments | −1 | −1 | −1 |

Règles à appliquer :

- **Caractéristiques** : chacune de 1 à 5. Le minimum de 1 est compris dans le budget. Exemple du livre p. 37 : Genin = Combat 4, Infiltration 1, Perception 2, Soutien 1 = 8 points. La fiche part donc de 1 partout et affiche « 4 points restants » pour un Genin.
- **Arts ninja** : de 0 à un maximum par art à la création (6 / 9 / 12 selon le grade). Ce maximum ne s'applique plus après la création.
- **Fûinjutsu et Kuchiyose** : réservés aux Chûnin et plus, sauf exception. Pour un Genin, avertissement non bloquant.
- **Dépassement** : impossible de dépasser un budget (bouton + désactivé, message court).
- **PA** : dépensés en techniques (voir les coûts en section 5) ou en chakra : 1 PA = +2 chakra max.
- **Éléments** : le joueur choisit librement son affinité, sa seconde affinité (Chûnin et Jônin) et son élément faible. Les éléments restants passent automatiquement à −1. Un même élément ne peut pas avoir deux rôles.
- **Aspects** : 12 au maximum (2 par catégorie). Six suffisent pour commencer, les autres se complètent en jeu.
- **Clan et Kekkei Genkai** : un seul clan. Un seul Kekkei Genkai à la création : le 2e emplacement reste verrouillé en mode création.
- **Recommandations du livre** (avertissements, non bloquants) : pas de Sharingan au-delà du 1er Tomoe, pas de Senjutsu, pas de Yin-Yang à la création.
- **Fin de création** : bouton « Valider la création » qui passe en mode jeu. S'il reste des points non dépensés, avertissement sans blocage.

## 4. Mode jeu

En jeu, la fiche gère les jauges, calcule les réserves de dés, lance les d10 et compte les succès selon les règles du livre (p. 105 à 111).

### Jauges

- **Énergie vitale** : actuelle / max, boutons + et −. À 0 : « Hors combat ». À −max ou moins : « Mort ». Rappel affiché : l'énergie vitale actuelle = nombre maximum d'actions par tour. Le malus des blessures est géré à la table, pas sur la fiche.
- **Chakra** : actuel / max, boutons + et −, bouton « Remettre au max » (repos, méditation).

### Lanceur de d10

Valeur d'un dé : 10 = 2 succès, 5 à 9 = 1 succès, 4 = annule 1 succès, 1 à 3 = rien.

1. **Réserve de dés** = caractéristique choisie + art ninja (optionnel) + dés d'équipement + chakra supplémentaire + modificateur de maîtrise en dés + ajustement manuel. Option « Lancer de kunaï / shuriken » : Combat seul, sans art ninja.
2. **Avant le lancer**, afficher « Réussite spontanée jusqu'à difficulté X », avec X = (nombre de dés + succès automatiques) ÷ 2, arrondi à l'inférieur (p. 106).
3. **Lancer** : chaque dé s'affiche avec une couleur selon sa valeur (10, 5-9, 4, 1-3).
4. **Relances** : le joueur coche les traits qui s'appliquent au jet. Chaque trait coché donne 1 relance : le joueur touche le dé à relancer.
5. **Succès automatiques ajoutés** : maîtrise de la technique, valeur de l'élément pour une technique élémentaire (positive ou négative), succès d'équipement, ajustement manuel (distance −5 ou −10, domination élémentaire +5, etc.).
6. **Résultat** : total de succès + qualité de la réussite.

Garder l'historique local des 10 derniers jets.

| Succès | Qualité (p. 106) |
| --- | --- |
| Négatif | Lamentable |
| 0 | Médiocre |
| 1 à 2 | Moyenne |
| 3 à 5 | Honnête |
| 6 à 9 | Bonne |
| 10 à 14 | Grande |
| 15 à 19 | Excellente |
| 20 à 24 | Superbe |
| 25 à 29 | Fantastique |
| 30 et plus | Légendaire |

### Équipement dans le lanceur

C'est le système du shop qui s'applique, pas les exemples d'équipement du livre (p. 104).

- Chaque objet donne un bonus à une caractéristique : des dés, ou des succès pour les objets rares. Les bonus se cumulent avec n'importe quel art ninja.
- Pas de limite d'objets portés, mais le total est plafonné selon le grade : Genin +1 dé, Chûnin +2 dés, Jônin +3 dés et +1 succès.
- Arme légendaire (une seule par personnage) : +3 dés et +2 succès. Elle remplace le plafond.

### Techniques

| Maîtrise | Effet sur le jet |
| --- | --- |
| Débutant (D) | −2 dés |
| Connue (C) | −1 dé |
| Acquise (A) | aucun |
| Maîtrisée (M) | +1 succès |
| Perfectionnée (P) | +2 succès |
| Sublimée (S) | +3 succès |

Bouton « Lancer la technique » dans le tableau des techniques :

- **Condition** : l'art ninja de la technique doit être au moins égal à son coût en chakra. Sinon, la technique est bloquée avec un message.
- **Chakra supplémentaire** : réglable par le joueur, +1 dé par point. Le total (coût + supplément) ne dépasse pas le niveau de l'art ninja (p. 107).
- **Avant le jet** : la fiche retire le chakra dépensé (bloqué si le chakra actuel ne suffit pas), puis ouvre le lanceur déjà rempli : art ninja, maîtrise, élément, chakra supplémentaire. Le joueur choisit seulement la caractéristique.

### Aspects

Boutons à côté de chaque aspect rempli (p. 107) :

- **Appel positif** : −2 chakra, puis choix d'un effet. Les quatre premiers s'appliquent au prochain jet ou à la prochaine initiative, le dernier est affiché seulement :
  - +2 succès, ou +2 en initiative ;
  - ignorer les 4 ;
  - relancer tous les échecs, 4 inclus ;
  - ignorer le malus des blessures (rappel affiché) ;
  - décréter quelque chose sur un PNJ mineur (affichage seul).
- **Appel négatif** : +2 chakra, sans dépasser le max.

### Initiative

Initiative = 1d10 + Combat + valeur de Hayaiton (si débloqué) + 2 par aspect appelé pour l'initiative (p. 109). Le total donne des jetons. Un outil de répartition aide le joueur à les découper en tas :

- les tas ont tous des tailles différentes ;
- leur somme = le total des jetons ;
- leur nombre ne dépasse pas l'énergie vitale actuelle.

La fiche affiche ensuite les phases où le personnage agit, de la plus haute à la plus basse. Exemple du livre p. 110 : 10 jetons → 1, 2, 3, 4 = action aux phases 4, 3, 2 et 1. Une répartition 5 + 5 est refusée.

## 5. Progression et lien avec le shop

Le joueur saisit les PX et PA gagnés après chaque séance, puis les dépense avec des boutons qui affichent le coût et bloquent si le solde ne suffit pas.

### PX et PA

- Compteurs PX et PA : total gagné (saisi par le joueur), dépensé, disponible.
- Chaque dépense est notée dans un historique (date, achat, coût). Un bouton « Annuler la dernière dépense » permet de corriger une erreur.

| Achat | Coût | Limite |
| --- | --- | --- |
| +1 en caractéristique | niveau visé × 2 PX | max 5 ; ajoute une ligne de trait |
| +1 en art ninja | niveau visé en PX | aucune |
| +1 énergie vitale max | 4 PX | aucune |
| +2 chakra max | 1 PA | aucune |
| Nouvelle technique (niveau Débutant) | 1 PA | — |
| Maîtrise Débutant → Connue | 1 PA | — |
| Maîtrise Connue → Acquise | 1 PA | — |
| Maîtrise Acquise → Maîtrisée | 2 PA | — |
| Maîtrise Maîtrisée → Perfectionnée | 2 PA | — |
| Maîtrise Perfectionnée → Sublimée | 2 PA | — |
| +1 dans un élément à 0 ou négatif | 1 PA | 3 éléments au maximum au-dessus de 0 |
| +1 dans un élément positif | niveau visé en PA | même limite |

Une technique coûte donc 9 PA au total, de son apprentissage jusqu'à Sublimée. Ces coûts s'appliquent aussi aux PA dépensés à la création.

### Grade

Le joueur change son grade à la main quand il monte en grade. Le grade change le plafond d'équipement. Il ne recalcule pas les budgets de création.

### Natures combinées et Kekkei Genkai

Sur la roue, chaque nature combinée s'allume quand ses prérequis de techniques sont remplis. Un bouton « Débloquer (enseignement reçu) » la rend utilisable. L'apprentissage en jeu reste décidé par le MJ. Combinaisons, clans et effets : pages 50 à 58 du livre et roue de la fiche papier.

| Nature | Prérequis | Niveau | Effet à afficher |
| --- | --- | --- | --- |
| Sublimée (Enton, Kutton, Denton, Shoton, Awaton) | élément de base positif + une technique de cet élément au niveau Sublimée | — | chaque succès de marge compte double |
| Double (Shakuton, Bakuton, Hiton, Hayaiton, Sunaton, Nendoton, Ranton, Yoton, Futton, Saifoton) | deux techniques Perfectionnées, une de chaque élément | le plus faible des deux éléments | Hayaiton s'ajoute à l'initiative |
| Triple (Jiton) | les trois éléments positifs + une technique Maîtrisée dans chacun | le plus faible des trois | 2 blessures par succès de marge |
| Kekkei Genkai double (Mokuton, Hyoton, Kennaiton) | aspect Hérédité + deux techniques Perfectionnées | le plus faible des deux | 2 blessures par succès de marge |
| Kekkei Tôta (Jinton, etc.) | aspect Hérédité + trois techniques Maîtrisées | le plus faible des trois | 2 blessures par succès de marge |

Pour ça, chaque technique a un champ « Élément » (aucun, ou l'un des éléments). Un Dojutsu (Sharingan, Byakugan…) se note comme une technique dans le tableau, avec son rang.

### Lien avec le shop

- **Bourse de ryos** : la même que celle du shop (même clé de stockage). Un achat au shop se voit tout de suite dans l'onglet Sac, et l'inverse.
- **Équipement** : les objets achetés au shop arrivent dans l'onglet Sac avec leur caractéristique et leur bonus. Le joueur peut aussi ajouter un objet à la main (récompense de scénario, arme légendaire).
- **Plusieurs fiches** : si le shop ne gère qu'une bourse par navigateur, la relier à la fiche active et le signaler dans le résumé de fin de travail.

## 6. Hors périmètre et validation

Hors périmètre pour cette version :

- vue MJ de toutes les fiches et historique des jets partagé (prévus plus tard) ;
- malus des blessures (géré à la table) ;
- colonne TH et mention « En création : +1 pt de chakra » ;
- équipement d'exemple du livre (bandeau, veste renforcée) : seul le système du shop compte ;
- toute base de données, tout compte ou serveur.

À tester avant de livrer, sur téléphone et sur PC :

- [ ] Créer un Genin : 4 points de caractéristique restants au départ, impossible de dépasser 5 dans une caractéristique ou 6 dans un art ninja.
- [ ] Un Genin avec Fûinjutsu > 0 affiche l'avertissement sans être bloqué.
- [ ] Choisir affinité Vent et élément faible Feu en Genin : Vent +1, Feu −2, Foudre, Terre et Eau −1.
- [ ] Dépenser 1 PA en chakra : chakra max 20 → 22.
- [ ] Combat 3 avec 3 traits : la fiche affiche 3 lignes de trait ; cocher 2 traits donne 2 relances.
- [ ] Une technique de rang C (coût 3) avec Ninjutsu 2 est bloquée ; avec Ninjutsu 5, le chakra supplémentaire est limité à 2.
- [ ] Une technique Maîtrisée ajoute +1 succès ; une technique Débutant retire 2 dés.
- [ ] Passer une technique d'Acquise à Maîtrisée coûte 2 PA ; de Débutant à Connue, 1 PA.
- [ ] Un Genin avec trois objets +1 dé en Combat n'a que +1 dé au lanceur.
- [ ] Appel positif d'un aspect : −2 chakra et effet appliqué au jet suivant ; appel négatif : +2 chakra sans dépasser le max.
- [ ] Initiative de 10 jetons avec 5 d'énergie vitale : 1-2-3-4 accepté, 5-5 refusé.
- [ ] Énergie vitale à 0 : « Hors combat » ; à −5 pour un max de 5 : « Mort ».
- [ ] Un achat au shop débite la bourse affichée sur la fiche et ajoute l'objet au Sac.
- [ ] Exporter une fiche, la supprimer, l'importer : tout revient à l'identique.
- [ ] Stockage bloqué (navigation privée) : la fiche s'affiche et prévient que rien ne sera gardé.

Point encore ouvert : les techniques de départ (Henge, Kawarimi, Bunshin) sont-elles gratuites, et à quel niveau de maîtrise ? Par défaut : gratuites, niveau Débutant, modifiables par le joueur.
