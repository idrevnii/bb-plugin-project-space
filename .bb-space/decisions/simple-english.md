# Simplified Technical English

This decision sets the language of the pages in this space. We use most of
ASD-STE100, the controlled English of aircraft manuals. ***Write short,
active sentences, and give each word one meaning.***

**Decision.** The pages in this space, `AGENTS.md` and `README.md` follow the
writing rules of ASD-STE100. We do not check each word against the STE
dictionary. This is about 80 % of the standard.

## Why

People come back to this space after weeks and scan it fast. Some readers do
not read English as a first language. Short sentences with one topic are
faster to scan and easier to translate.

An instruction with one command in one sentence is easy to follow. This is
true for a person and for an agent. The old pages were correct, but many
sentences had three clauses and an idiom.

We do not use the STE dictionary. It approves about 900 general words, and
software text needs many words that it does not have, for example *commit*,
*render* or *merge*. A check of each word costs more than it gives in a
project of this size.

## The rules

| Rule | Not this | This |
| --- | --- | --- |
| Use the command form for instructions. Write one instruction in each sentence. | You'll want to install the deps and then run the check. | Install the dependencies. Then run `npm run check`. |
| Write 20 words or fewer in an instruction and 25 words or fewer in a description. | — | — |
| Use the active voice. | The file is saved by the editor. | The editor saves the file. |
| Use the simple tenses: present, past and future. Do not use *-ing* forms as verbs. | The watcher is publishing an event. | The watcher publishes an event. |
| Put the condition first. | Run it again if it fails. | If it fails, run it again. |
| Use each word with one meaning. Use the words in the [glossary](../index.md#words-in-this-space). | the board, the canvas, the drawing | the canvas |
| Write noun clusters of three words or fewer. | the space tree drop target highlight | the highlight on the drop target |
| Keep the articles and *that*. Do not write in telegraph style. | Open file, press Edit. | Open the file and click **Edit**. |
| Use a simple verb, not a phrasal verb or an idiom. | show up, pick up, go back, close the loop | appear, take, return, finish |
| Use *can* for ability and *must* for a requirement. Do not use *may* or *should*. | The canvas may be stale. | The picture can be old. |
| Write six sentences or fewer in a paragraph, about one topic. | — | — |
| Start a warning or a caution with a command. Then give the reason. | Reloading from a worktree is risky. | Do not reload from a worktree. The reload replaces the plugin for all agents. |

### What the rules do not cover

- **Technical names** — code, commands, paths, setting names, UI labels and
  product names stay as they are, for example `using-the-space.md` or
  *File tree position*.
- **Technical verbs** — software verbs that STE does not approve, for example
  *render*, *parse*, *commit*, *merge* and *debounce*.
- **Table cells and list labels** — these can be short phrases, not full
  sentences.

## Rejected

- **Full ASD-STE100** — each change needs a check against the dictionary,
  with a tool or a trained writer. Many software words are not approved, so
  the text gets longer and less exact.
- **No language rule** — the pages stay correct, but long sentences make them
  slow to scan.

## Consequences

- Write new pages with these rules. The skill's *Write for a reader* section
  still sets the format: the lead, headings, callouts, tables and pictures.
- Some things are easier to see than to read: a flow, a set of states or a
  screen layout. Show them as a picture: a Mermaid block, a canvas or a text
  sketch.
- The briefs of merged tasks in [tasks](../tasks/index.md) are history. They
  keep their old text.
- The plugin's skill does not include these rules yet, so the spaces of other
  projects do not change.
