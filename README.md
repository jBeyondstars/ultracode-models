# ultracode-models

Un mod Claude Code (terminal et Desktop) pour choisir **le modèle et l'effort de tous les sous-agents** :
- ceux que lance l'outil Agent ;
- ceux que démarre `agent()` dans un workflow Ultracode ;
- les sous-agents qu'ils lancent eux-mêmes.

Si vous choisissez Haiku, **tous** les sous-agents tournent sur Haiku, quoi que demande Claude ou le script du workflow. La conversation principale, elle, n'est jamais modifiée.

## Utilisation

| Commande | Effet |
| --- | --- |
| `/ultramodels` | ouvre ou ferme le panneau de réglages |
| `/ultramodels haiku` | modèle de tous les sous-agents |
| `/ultramodels sonnet medium` | modèle et effort de tous les sous-agents |
| `/ultramodels effort low` | change seulement l'effort |
| `/ultramodels model <identifiant> [effort]` | n'importe quel identifiant de modèle (ARN Bedrock, passerelle…) |
| `/ultramodels on`, `off`, `status`, `reset` | activer, désactiver, afficher les réglages, tout remettre à « hérité » |
| `/ultramodels log clear` | retire les sous-agents terminés de la liste du panneau |

Modèles acceptés directement : `haiku`, `sonnet`, `opus`, `fable`, `inherit` (aucun changement), ou un identifiant contenant `claude-` (par exemple `claude-opus-4-8`). Pour tout autre identifiant, utilisez `model <identifiant>`. Efforts : `low`, `medium`, `high`, `xhigh`, `max` ou `inherit`.

Le **panneau** (`/ultramodels`) se lit de haut en bas :
- **l'état** du mod (● Actif / ○ Désactivé) et le bouton pour le changer ;
- **les compteurs de la session** : nombre de sous-agents, tokens consommés et part de chaque modèle. Ces chiffres sont exacts : ce sont ceux de l'API ;
- **Modèle** et **Effort** : une rangée de boutons chacun, l'option active en surbrillance, un clic suffit ;
- **Récents** : les 12 derniers sous-agents. Chaque ligne montre une marque d'état (qui tourne tant que l'agent travaille), le modèle remplacé barré quand il est connu avec certitude, le modèle qui a répondu, le label, l'effort, la durée et les tokens.

Sur Desktop, VS Code et mobile, les compteurs et la liste sont dessinés en SVG et suivent le thème clair ou sombre. Sur le terminal, ils s'affichent en texte, et des raccourcis marchent quand le panneau a le clavier :
- `h` `s` `o` `f` `i` pour le modèle (Haiku, Sonnet, Opus, Fable, Hérité) ;
- `0` à `5` pour l'effort ;
- `a` pour activer ou désactiver ;
- `c` pour effacer.

Le panneau n'affiche pas d'« économies en dollars », parce qu'on ne peut pas les calculer correctement :
- on ignore ce que le modèle d'origine aurait consommé (autres réponses, autre tokenizer) ;
- l'API ne dit pas à quel tarif de cache les écritures ont été facturées.

Vous pouvez aussi demander à Claude : « passe tous les sous-agents sur Haiku ». Le mod lui fournit deux outils :
- `status` affiche les réglages et les derniers sous-agents ;
- `configure` reprend la syntaxe de la commande. Il n'est utilisable que depuis la conversation principale.

À chaque changement de réglages, et après une compaction, Claude reçoit une courte note avec le prompt suivant.

## Fonctionnement

Le mod applique le même réglage à chaque sous-agent, de la façon que le moteur permet :
- **Sous-agent ordinaire** (outil Agent, sous-agent d'un sous-agent) : le modèle est fixé dès le lancement (hook `agent.spawn`). Claude Code sait donc qu'il tourne sur Haiku, et le paramètre `model` de l'appel est remplacé.
- **Agent de workflow** (`agent()`) et **fork** : le moteur ne permet pas de les modifier au lancement. Le mod réécrit donc le modèle de **chaque requête** avant l'envoi (hook `turn.step`).
- **L'effort** est réécrit sur chaque requête, pour tous.

Le réglage est figé au lancement de chaque sous-agent : le modifier n'affecte que les sous-agents lancés ensuite. Les sous-agents en cours gardent leur réglage même si le mod est rechargé.

Si le moteur bascule de lui-même une requête sur un modèle de repli (après un refus, par exemple), le mod laisse passer ce choix.

Les réglages sont conservés d'une session à l'autre, dans le stockage du mod.

## Limites connues

- Un agent lancé avec `isolation: 'remote'` tourne dans le cloud et ne passe pas par les hooks locaux : il n'est pas redirigé.
- Si le moteur relance un agent de workflow bloqué sous un nouvel identifiant, cette relance n'est pas reconnue.
- Un agent de workflow ou un fork redirigé a reçu une invite système préparée pour son modèle d'origine : il peut se croire Opus alors qu'il tourne sur Haiku. Le modèle affiché après la flèche dans le panneau (et `answeredBy` dans l'outil `status`) est celui qu'indique l'API.
- Le harnais Workflow transmet à chaque agent le message d'origine de l'utilisateur. Un petit modèle comme Haiku peut le prendre pour sa propre tâche quand ce message est lui-même une consigne d'orchestration (« lance 3 sous-agents… »).
- Les alias (`sonnet`…) sont traduits en identifiants complets (`claude-sonnet-5-5`), en respectant `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` et `ANTHROPIC_DEFAULT_HAIKU_MODEL` s'ils sont définis. Sur Bedrock, Vertex ou une passerelle, définissez ces variables ou indiquez un identifiant complet avec `model <identifiant>`.
- Si le modèle choisi ne vous est pas accessible, les sous-agents échouent et le mod affiche une notification (une par workflow et par modèle).

## Installation

Dans Claude Code lancé depuis un terminal (`claude`), tapez :

```
/plugin install ultracode-models --marketplace jBeyondstars/ultracode-models
```

Répondez `y` pour ajouter le marketplace, puis validez la portée « user » avec Entrée. Le mod est actif tout de suite, puis dans chaque session lancée ensuite, y compris celles de l'onglet Code de l'app Desktop (la commande `/plugin` n'y est pas disponible, d'où le terminal).

Pour essayer une copie locale sans l'installer : `claude --plugin-dir <dossier>`, ou ajoutez le dossier à `CLAUDE_CODE_PLUGIN_DIRS` dans le bloc `env` de `~/.claude/settings.json` (cela marche aussi pour les sessions lancées par l'app Desktop).

## Développement

```bash
claude plugin validate .
claude plugin test .
```

`tsc -p .` vérifie les types une fois que Claude Code a chargé le mod (avec `--plugin-dir`, par exemple) : il écrit alors ses types dans `.claude-plugin/types/`, un dossier que git ignore.

Les tests couvrent :
- la logique pure, dans `tests/logic.test.ts` ;
- le mod complet sur un moteur simulé par le kit de test, dans `tests/mod.test.ts`.

Côté mod, ils vérifient notamment :
- chaque sorte de sous-agent : outil Agent, agent de workflow, fork, sous-agent d'un sous-agent ;
- que la conversation principale n'est pas touchée ;
- le rechargement, l'attente d'un lancement, le modèle de repli du moteur ;
- la note au modèle, les outils, et le panneau sur terminal, desktop et mobile.
