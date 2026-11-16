# Live Poll

Sondaggi live da proiettare come overlay in OBS Studio. Il pubblico vota scrivendo
la lettera della risposta in chat (Teams, YouTube, ecc.); i messaggi arrivano
tramite Social Stream Ninja.

## Avvio

Doppio clic su `Avvia Live Poll.command`, oppure:

    node server.js

- Pannello di regia: http://127.0.0.1:4330/
- Overlay per OBS:   http://127.0.0.1:4330/overlay

Non ci sono dipendenze da installare. Sondaggi e impostazioni sono salvati in
`data/polls.json`; i voti restano in memoria fino al riavvio del server.

## Configurazione

1. In OBS aggiungi una sorgente **Browser** con URL `http://127.0.0.1:4330/overlay`,
   1920 x 1080. Lo sfondo è trasparente.
2. Nel pannello, sezione Impostazioni, inserisci l'**ID sessione** di Social Stream
   Ninja (la parte dopo `session=` nei suoi link).
3. Crea i sondaggi: a mano oppure incollando il testo "Domanda: ... * A. ... * B. ...".

È l'overlay aperto in OBS a ricevere la chat e a inoltrare i voti al server.

## Come vengono contati i voti

- Un messaggio vale come voto solo se contiene unicamente una lettera valida:
  `a`, `B`, `c)`, `D.`
- Un voto per persona: chi riscrive cambia il proprio voto.
- I voti contano solo a votazione aperta. "Mostra domanda" la apre da sola.

## Comandi (pannello, tastiera, Stream Deck)

Ogni comando è anche una richiesta GET, utilizzabile da Stream Deck:

    http://127.0.0.1:4330/control/<comando>

| Comando    | Tasto  | Effetto                                   |
|------------|--------|-------------------------------------------|
| `question` | Q      | Mostra la domanda e apre il voto          |
| `results`  | R      | Mostra i risultati aggregati              |
| `toggle`   | Spazio | Alterna domanda e risultati               |
| `hide`     | H      | Nasconde l'overlay                        |
| `open` / `close` | V | Apre o chiude il voto                   |
| `next` / `prev`  | → ← | Sondaggio successivo o precedente     |
| `reveal`   |        | Evidenzia la risposta corretta, se c'è    |
| `reset`    |        | Azzera i voti del sondaggio attivo        |
