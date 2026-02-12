// roasts.js
// ─────────────────────────────────────────────────────────────────────────────
// Random roast module — 10% chance to fire a playful jab at anyone who
// talks in the configured channel.
//
// Features:
//   - Language & UK-regional roast pools
//   - Per-user pool assignment (persisted to data/roast_users.json)
//   - !addinsults <UID|@mention> <location>   — assign a pool to a user
//   - !removeinsults <UID|@mention>           — remove a user's assignment
//   - !listinsults                            — show all assigned users
//   - !roastlocations                         — list every available pool
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROAST_CHANNEL_ID = '1392207686396940332';
const ROAST_CHANCE     = 0.04; // 4%
const DATA_DIR         = path.join(__dirname, 'data');
const USERS_FILE       = path.join(DATA_DIR, 'roast_users.json');

// ═════════════════════════════════════════════════════════════════════════════
//  ROAST POOLS
// ═════════════════════════════════════════════════════════════════════════════

const roastsByLang = {

  // ─────────────────────────── LANGUAGES ──────────────────────────────────

  // ── English (default) ─────────────────────────────────────────────────
  en: [
    "You type like you play — slow and confused.",
    "I've seen better takes from a goblin.",
    "Are you even trying, or is this your best?",
    "Somewhere out there a village is missing its idiot… oh wait, found them.",
    "Your IQ and your KC have something in common — both tragically low.",
    "Mate, you couldn't combo eat your way out of a paper bag.",
    "Were you dropped as a child or did you just start playing like that naturally?",
    "Even Jad feels sorry for you.",
    "I'd explain it to you but I left my crayons at home.",
    "You're the reason the duel arena got removed.",
    "If you were any slower you'd be going backwards.",
    "You bring everyone so much joy… when you leave.",
    "You're living proof that anyone can use a keyboard.",
    "Your gear setup looks like it was assembled by a blindfolded toddler.",
    "Bro really logged in just to embarrass himself.",
    "The GE tax is smarter than you.",
    "Even a bronze dagger would be an upgrade for your takes.",
    "If bad takes were XP, you'd be maxed by now.",
    "You're proof that tutorial island doesn't teach everything.",
    "Were you AFK when they handed out brain cells?",
    "Your parents must look at you and wonder where it all went wrong.",
    "The best part of you dribbled down your mother's leg.",
    "You have the personality of a wet sock left in a Tesco car park.",
    "I've met NPCs with more going on upstairs than you.",
    "If you were any more inbred you'd be a sandwich.",
    "Your family tree is a wreath.",
    "You're the reason God doesn't talk to us anymore.",
    "Even your pet would re-home itself if it could.",
    "Honestly, your existence is the best argument for birth control.",
    "You've got the charisma of a dead battery.",
    "Every time you speak, the average IQ of the server drops.",
    "You're not the dumbest person in the world, but you better hope they don't die.",
    "The gene pool could use a lifeguard when you're around.",
    "You're what happens when cousins share more than a surname.",
    "Your birth certificate is an apology letter from the condom factory.",
    "If stupidity was painful you'd be in a coma.",
    "You couldn't pour water out of a boot if the instructions were on the heel.",
    "I'd call you a tool but at least tools are useful.",
    "Your existence is proof that evolution can go in reverse.",
    "You're the human equivalent of a participation trophy.",
    "Even your mirror is disappointed.",
    "You're the reason shampoo bottles have instructions.",
    "Somewhere, a tree is working hard to produce oxygen for you. Apologise to it.",
    "If brains were dynamite, you wouldn't have enough to blow your nose.",
    "You're about as sharp as a bowling ball.",
    "God spent so long on your looks he forgot to install a brain.",
    "You're a few chromosomes short of a full set, aren't you?",
    "I've scraped more interesting things off the bottom of my shoe.",
    "The lights are on but nobody's been home for years.",
    "You make me wish I had more middle fingers.",
    "If your mum had any sense she'd have kept the afterbirth and thrown you away.",
    "You're the load your mum should've swallowed.",
    "Your dad should've finished on the curtains instead.",
    "You're the reason they invented the morning-after pill.",
    "If I wanted to kill myself, I'd climb your ego and jump to your IQ.",
    "The only thing you're good for is being a bad example.",
    "You look like something I'd draw with my left hand.",
    "I've flushed things with more potential than you.",
    "You're the cum stain on the mattress of humanity.",
    "You're so useless, your mum wishes she'd kept the dog instead.",
    "Even a coat hanger couldn't have saved us from you.",
    "You're the human equivalent of stepping in a wet patch with fresh socks.",
    "Your mum's biggest regret doesn't need an introduction — it just typed in chat.",
    "The morgue has livelier company than you.",
    "If you were any more dead inside you'd need a coffin.",
    "Your personality is a war crime.",
    "You make depression look like a lifestyle choice.",
    "If your life was a movie, it would be straight to the bargain bin at a charity shop.",
    "You're the reason therapists need therapists.",
    "You're what would happen if a used condom gained sentience and learned to type.",
    "Your mother's womb was a clown car and you were the saddest act.",
    "You look like God tried to make a person out of Play-Doh and gave up halfway.",
    "You're the skidmark on the underwear of society.",
    "If you were a flavour you'd be wet cardboard.",
    "The only thing that's ever come first in your life is your dad — and even that was premature.",
    "Your mum's only fans page has more subscribers than people who give a shit about you.",
    "You're the physical embodiment of an error message.",
    "I've had shits with more charisma than you.",
    "You look like the before AND after photo on a meth campaign.",
    "Even your hand tries to friend-zone you.",
    "Your gene pool needs a hazmat cleanup.",
    "If wanking was a sport you'd finally have a gold medal.",
    "You're what happens when the pull-out method fails and nobody steps up.",
    "You were an accident that even insurance won't cover.",
    "Your face is the reason God created the reverse camera.",
    "The abortion clinic called — they said it's never too late to discuss options.",
    "You couldn't get laid in a morgue with a fistful of cash.",
    "Your mum had morning sickness for 9 months. She's had you sickness ever since.",
    "If ugly was a currency you'd be a billionaire.",
    "Your dad's pullout game is weaker than your gameplay — and that's saying something.",
    "You look like you were bullied by the other sperm and still somehow won.",
    "Your search history is the only thing about you that's interesting, and even that's depressing.",
    "Even a glory hole would put up an 'out of order' sign when you showed up.",
  ],

  // ── Dutch ─────────────────────────────────────────────────────────────
  dutch: [
    "Jij bent zo nutteloos als een paraplu in de Sahara.",
    "Als domheid pijn deed, zou jij de hele dag schreeuwen.",
    "Je bent niet de scherpste kaas op de plank, hè?",
    "Zelfs je moeder zou op 'ignore' klikken.",
    "Je hebt het charisma van een natte boterham.",
    "Was je aan het AFK'en toen de hersencellen werden uitgedeeld?",
    "Jij bent het bewijs dat iedereen een toetsenbord kan gebruiken.",
    "Je bent langzamer dan het internet in 1999.",
    "Als slechte takes XP waren, was jij allang maxed.",
    "Jij bent de reden dat de GE een tax heeft.",
    "Je bent zo dom, je probeert vis te vangen in de woestijn.",
    "Zelfs een tutorial zou jou niet kunnen helpen.",
    "Jij hebt twee hersencellen en ze vechten allebei om de laatste plaats.",
    "Als jij een spice was, zou je bloem zijn.",
    "Je bent het soort persoon dat op de verkeerde server inlogt.",
    "Je bent zo dom dat je verdrinkt in een kiddie pool.",
    "Jouw ouders kijken naar je en denken: waar ging het mis?",
    "Het beste deel van jou is langs je moeders been naar beneden gelopen.",
    "Je stamboom is een cirkel.",
    "Als hersenen dynamiet waren, had jij niet genoeg om je neus te snuiten.",
    "Jij bent het levende bewijs dat evolutie ook achteruit kan gaan.",
    "Je bent zo nutteloos dat zelfs je schaduw probeert weg te lopen.",
    "Ergens werkt een boom keihard om zuurstof voor jou te produceren. Bied je excuses aan.",
    "Jij bent de reden dat shampooflessen instructies hebben.",
    "God heeft zo lang aan je uiterlijk gewerkt dat hij vergat een brein te installeren.",
    "Je bent de menselijke versie van een deelname-trofee.",
    "Elke keer als jij praat, daalt het gemiddelde IQ van de server.",
    "Je geboorteakte is een excuusbrief van de condoomfabriek.",
    "Zelfs je spiegel is teleurgesteld.",
    "Als je nog meer inteelt was, was je een broodje.",
    "Je bent de reden dat God niet meer met ons praat.",
    "De lichten zijn aan maar er is al jaren niemand thuis.",
    "Ik heb interessantere dingen van de onderkant van mijn schoen geschraapt.",
    "Je bent zo'n teleurstelling dat zelfs je WiFi de verbinding verbreekt.",
    "Jij bent het type dat zijn eigen naam verkeerd spelt.",
    "Je hebt het uithoudingsvermogen van een natte lucifer.",
    "Zelfs Google kan geen resultaten vinden voor jouw talenten.",
    "Je bent de menselijke equivalent van een 404-fout.",
    "Als jij een kaars was, zou je niet eens de moeite waard zijn om uit te blazen.",
    "Als je moeder verstand had, had ze de nageboorte gehouden en jou weggegooid.",
    "Je bent de lading die je moeder had moeten inslikken.",
    "Je vader had beter op de gordijnen kunnen eindigen.",
    "Ik heb dingen doorgespoeld met meer potentieel dan jij.",
    "Je bent de cumvlek op het matras van de mensheid.",
    "Je bent zo nutteloos dat je moeder wenste dat ze de hond had gehouden.",
    "Je persoonlijkheid is een oorlogsmisdaad.",
    "Als je nog meer dood van binnen was, had je een kist nodig.",
    "Het mortuarium heeft gezelliger gezelschap dan jij.",
    "Je bent de reden dat therapeuten zelf een therapeut nodig hebben.",
    "Als je leven een film was, ging die rechtstreeks naar de vuilnisbak.",
    "Je moeders grootste spijt hoeft zich niet voor te stellen — die typte net in de chat.",
    "Zelfs een kleerhanger had ons niet van jou kunnen redden.",
    "Als ik zelfmoord wilde plegen, zou ik op je ego klimmen en naar je IQ springen.",
    "Je bent het menselijk equivalent van in een nat stuk stappen met schone sokken.",
    "Je maakt depressie tot een levensstijlkeuze.",
    "Je bent zo lelijk dat zelfs je hand nee zegt.",
    "Als jouw leven een boek was, zou niemand het lezen — zelfs niet gratis.",
    "Je bent het bewijs dat sommige mensen beter een abortusverhaal hadden kunnen zijn.",
    "Je bent wat er gebeurt als een gebruikt condoom bewustzijn krijgt en leert typen.",
    "De baarmoeder van je moeder was een clownsauto en jij was het zieligste act.",
    "Je bent de remstreep op het ondergoed van de samenleving.",
    "Het enige dat ooit als eerste kwam in je leven was je vader — en zelfs dat was voortijdig.",
    "Ik heb drollen gehad met meer charisma dan jij.",
    "Je ziet eruit als de voor- EN na-foto van een meth-campagne.",
    "Zelfs je hand probeert je te friendzonen.",
    "Je genenpoel heeft een chemische reiniging nodig.",
    "Als rukken een sport was had je eindelijk een gouden medaille.",
    "Je was een ongelukje dat zelfs een verzekering niet dekt.",
    "Je gezicht is de reden dat God de achteruitrijcamera heeft gemaakt.",
    "De abortuskliniek belde — ze zeiden dat het nooit te laat is om opties te bespreken.",
    "Je zou niet eens gescoord krijgen in een mortuarium met een handvol cash.",
    "Als lelijkheid een valuta was, zou je miljardair zijn.",
    "Je vader's pullout game is zwakker dan je gameplay — en dat zegt wat.",
    "Je ziet eruit alsof je gepest werd door de andere zaadcellen en toch op de een of andere manier won.",
    "Je zoekgeschiedenis is het enige interessante aan je, en zelfs dat is deprimerend.",
    "Je moeder had 9 maanden ochtendmisselijkheid. Daarna had ze jou-misselijkheid.",
    "Zelfs een glory hole zou een 'buiten dienst' bordje ophangen als jij verscheen.",
  ],

  // ── Danish ────────────────────────────────────────────────────────────
  danish: [
    "Du taster som du spiller — langsomt og forvirret.",
    "Jeg har set bedre takes fra en goblin.",
    "Prøver du overhovedet, eller er det her dit bedste?",
    "Et eller andet sted mangler en landsby sin idiot… åh vent, fandt ham.",
    "Din IQ og dit KC har noget til fælles — begge tragisk lave.",
    "Selv Jad har ondt af dig.",
    "Jeg ville forklare det for dig, men jeg glemte mine farveblyanter.",
    "Du er grunden til at duel arenaen blev fjernet.",
    "Hvis du var langsommere, ville du gå baglæns.",
    "Du bringer alle så meget glæde… når du går.",
    "Du er det levende bevis på at alle kan bruge et tastatur.",
    "Dit gear setup ser ud som om det blev samlet af et blindfoldet barn.",
    "Bansen loggede virkelig ind bare for at gøre sig selv til grin.",
    "GE-skatten er klogere end dig.",
    "Hvis dårlige takes gav XP, ville du være maxed for længst.",
    "Var du AFK da hjernecellerne blev uddelt?",
    "Du har to hjerneceller og de kæmper begge om sidstepladsen.",
    "Selv en bronze dolk ville være en opgradering til dine takes.",
    "Du er beviset på at Tutorial Island ikke lærer folk alt.",
    "Selv din mor ville klikke 'ignore'.",
    "Dine forældre ser på dig og undrer sig over, hvor det gik galt.",
    "Den bedste del af dig løb ned ad din mors ben.",
    "Dit stamtræ er en cirkel.",
    "Hvis hjerner var dynamit, havde du ikke nok til at pudse næse.",
    "Du er det levende bevis på at evolution også kan gå baglæns.",
    "Du er så ubrugelig at selv din skygge prøver at løbe væk.",
    "Et sted arbejder et træ hårdt for at lave ilt til dig. Sig undskyld til det.",
    "Du er grunden til at shampoflasker har brugsanvisning.",
    "Gud brugte så lang tid på dit udseende at han glemte at installere en hjerne.",
    "Du er den menneskelige version af en deltagerpræmie.",
    "Hver gang du taler, falder serverens gennemsnitlige IQ.",
    "Din fødselsattest er et undskyldningsbrev fra kondomfabrikken.",
    "Selv dit spejl er skuffet.",
    "Du er grunden til at Gud ikke taler med os længere.",
    "Lysene er tændt, men der har ikke været nogen hjemme i årevis.",
    "Jeg har skrabet mere interessante ting af bunden af min sko.",
    "Du er den type der staver sit eget navn forkert.",
    "Selv Google kan ikke finde resultater for dine talenter.",
    "Du er den menneskelige ækvivalent til en 404-fejl.",
    "Hvis din mor havde haft fornuft, havde hun beholdt moderkagen og smidt dig ud.",
    "Du er den ladning din mor burde have slugt.",
    "Din far burde have afsluttet på gardinerne i stedet.",
    "Jeg har skyllet ting ud med mere potentiale end dig.",
    "Du er cumpletten på menneskehedens madras.",
    "Du er så ubrugelig at din mor ønsker hun havde beholdt hunden.",
    "Din personlighed er en krigsforbrydelse.",
    "Hvis du var mere død indeni, ville du have brug for en kiste.",
    "Lighuset har livligere selskab end dig.",
    "Du er grunden til at terapeuter har brug for terapeuter.",
    "Hvis dit liv var en film, ville den gå direkte i skraldespanden.",
    "Din mors største fortrydelse behøver ingen introduktion — den tastede lige i chatten.",
    "Selv en bøjle kunne ikke have reddet os fra dig.",
    "Hvis jeg ville slå mig selv ihjel, ville jeg klatre op på dit ego og hoppe ned til din IQ.",
    "Du er den menneskelige ækvivalent af at træde i en våd plet med rene sokker.",
    "Du gør depression til et livsstilsvalg.",
    "Du er så grim at selv din hånd siger nej.",
    "Hvis dit liv var en bog, ville ingen læse den — selv ikke gratis.",
    "Du er beviset på at nogle mennesker burde have været en aborthistorie.",
    "Du er hvad der sker når et brugt kondom får bevidsthed og lærer at skrive.",
    "Din mors livmoder var en klovnebil og du var det mest sørgelige nummer.",
    "Du er bremssporet på samfundets underbukser.",
    "Det eneste der nogensinde er kommet først i dit liv var din far — og selv det var for tidligt.",
    "Jeg har haft lort med mere karisma end dig.",
    "Du ligner både før- OG efter-billedet på en meth-kampagne.",
    "Selv din hånd prøver at friendzone dig.",
    "Din genpool kræver en kemisk oprydning.",
    "Hvis onani var en sport ville du endelig have en guldmedalje.",
    "Du var en ulykke som selv en forsikring ikke dækker.",
    "Dit ansigt er grunden til at Gud opfandt bakkameraet.",
    "Abortklinikken ringede — de sagde det aldrig er for sent at diskutere muligheder.",
    "Du kunne ikke score i et lighus med en håndfuld kontanter.",
    "Hvis grimhed var en valuta ville du være milliardær.",
    "Din fars pullout game er svagere end dit gameplay — og det siger noget.",
    "Du ser ud som om du blev mobbet af de andre sædceller og alligevel på en eller anden måde vandt.",
    "Din søgehistorik er det eneste interessante ved dig, og selv det er deprimerende.",
    "Din mor havde morgenkvalme i 9 måneder. Hun har haft dig-kvalme lige siden.",
    "Selv et glory hole ville sætte et 'ude af drift' skilt op når du dukkede op.",
  ],

  // ── German ────────────────────────────────────────────────────────────
  german: [
    "Du tippst wie du spielst — langsam und verwirrt.",
    "Selbst ein Goblin hat bessere Takes als du.",
    "Wenn Dummheit fliegen könnte, wärst du ein Düsenjet.",
    "Du bist der Grund, warum es Tutorials gibt.",
    "Sogar Jad tut es leid für dich.",
    "Du hast das Charisma eines nassen Brötchens.",
    "Warst du AFK, als die Gehirnzellen verteilt wurden?",
    "Wenn schlechte Takes XP wären, wärst du längst maxed.",
    "Du bist der lebende Beweis, dass jeder eine Tastatur benutzen kann.",
    "Selbst die GE-Steuer ist schlauer als du.",
    "Irgendwo da draußen vermisst ein Dorf seinen Idioten… oh warte.",
    "Du bringst allen so viel Freude… wenn du gehst.",
    "Du bist langsamer als Internet Explorer.",
    "Dein Gear-Setup sieht aus, als hätte es ein blindes Kleinkind zusammengestellt.",
    "Bro hat sich eingeloggt, nur um sich zu blamieren.",
  ],

  // ── French ────────────────────────────────────────────────────────────
  french: [
    "Tu tapes comme tu joues — lentement et confusément.",
    "J'ai vu de meilleurs avis venant d'un gobelin.",
    "T'es la raison pour laquelle le duel arena a été supprimé.",
    "Si la bêtise faisait mal, tu crierais toute la journée.",
    "Tu n'es pas le couteau le plus aiguisé du tiroir, hein?",
    "Même Jad a pitié de toi.",
    "Tu as le charisme d'un sandwich mouillé.",
    "T'étais AFK quand on distribuait les neurones?",
    "Si les mauvais takes donnaient de l'XP, tu serais max depuis longtemps.",
    "T'es la preuve vivante que n'importe qui peut utiliser un clavier.",
    "Quelque part, un village cherche son idiot… ah, trouvé.",
    "Tu apportes tellement de joie à tout le monde… quand tu pars.",
    "Même une dague en bronze serait un upgrade pour tes takes.",
    "Frère s'est connecté juste pour se ridiculiser.",
    "La taxe du GE est plus intelligente que toi.",
  ],

  // ── Spanish ───────────────────────────────────────────────────────────
  spanish: [
    "Tecleas como juegas — lento y confundido.",
    "He visto mejores opiniones de un goblin.",
    "Eres la razón por la que se eliminó el duel arena.",
    "Si la estupidez doliera, estarías gritando todo el día.",
    "No eres el cuchillo más afilado del cajón, ¿verdad?",
    "Hasta Jad siente lástima por ti.",
    "Tienes el carisma de un sándwich mojado.",
    "¿Estabas AFK cuando repartieron las neuronas?",
    "Si los malos takes dieran XP, ya serías max.",
    "Eres la prueba viviente de que cualquiera puede usar un teclado.",
    "En algún lugar un pueblo busca a su idiota… ah, encontrado.",
    "Traes tanta alegría a todos… cuando te vas.",
    "Incluso una daga de bronce sería una mejora para tus takes.",
    "Bro se conectó solo para hacer el ridículo.",
    "El impuesto del GE es más inteligente que tú.",
  ],

  // ── Portuguese ────────────────────────────────────────────────────────
  portuguese: [
    "Tu escreves como jogas — devagar e confuso.",
    "Já vi melhores opiniões de um goblin.",
    "Tu és a razão pela qual a duel arena foi removida.",
    "Se a estupidez doesse, estavas a gritar o dia todo.",
    "Não és a faca mais afiada da gaveta, pois não?",
    "Até o Jad tem pena de ti.",
    "Tens o carisma de uma sandes molhada.",
    "Estavas AFK quando distribuíram os neurónios?",
    "Se os maus takes dessem XP, já eras maxed há muito.",
    "És a prova viva de que qualquer um pode usar um teclado.",
    "Algures, uma aldeia procura o seu idiota… ah, encontrado.",
    "Trazes tanta alegria a todos… quando te vais embora.",
    "Até uma adaga de bronze seria um upgrade para os teus takes.",
    "Mano logou só para se envergonhar.",
    "O imposto do GE é mais inteligente que tu.",
  ],

  // ── Italian ───────────────────────────────────────────────────────────
  italian: [
    "Scrivi come giochi — lento e confuso.",
    "Ho visto opinioni migliori da un goblin.",
    "Sei il motivo per cui hanno rimosso la duel arena.",
    "Se la stupidità facesse male, urleresti tutto il giorno.",
    "Non sei il coltello più affilato del cassetto, vero?",
    "Perfino Jad ha pietà di te.",
    "Hai il carisma di un panino bagnato.",
    "Eri AFK quando distribuivano i neuroni?",
    "Se i cattivi takes dessero XP, saresti maxed da un pezzo.",
    "Sei la prova vivente che chiunque può usare una tastiera.",
    "Da qualche parte un villaggio cerca il suo idiota… ah, trovato.",
    "Porti così tanta gioia a tutti… quando te ne vai.",
    "Anche un pugnale di bronzo sarebbe un upgrade per i tuoi takes.",
    "Fratello si è connesso solo per fare figuracce.",
    "La tassa del GE è più intelligente di te.",
  ],

  // ── Polish ────────────────────────────────────────────────────────────
  polish: [
    "Piszesz tak jak grasz — wolno i chaotycznie.",
    "Widziałem lepsze opinie od goblina.",
    "Jesteś powodem, dla którego usunęli duel arenę.",
    "Gdyby głupota bolała, krzyczałbyś cały dzień.",
    "Nie jesteś najostrzejszym nożem w szufladzie, co?",
    "Nawet Jad ci współczuje.",
    "Masz charyzmę mokrej kanapki.",
    "Byłeś AFK, kiedy rozdawali neurony?",
    "Gdyby złe opinie dawały XP, dawno byłbyś maxed.",
    "Jesteś żywym dowodem, że każdy może używać klawiatury.",
    "Gdzieś tam wioska szuka swojego idioty… a, znalazła.",
    "Sprawiasz wszystkim tyle radości… kiedy wychodzisz.",
    "Nawet brązowy sztylet byłby ulepszeniem twoich opinii.",
    "Ziomek zalogował się tylko żeby się ośmieszyć.",
    "Podatek GE jest mądrzejszy od ciebie.",
  ],

  // ── Swedish ───────────────────────────────────────────────────────────
  swedish: [
    "Du skriver som du spelar — långsamt och förvirrat.",
    "Jag har sett bättre åsikter från en goblin.",
    "Du är anledningen till att duel arenan togs bort.",
    "Om dumhet gjorde ont, skulle du skrika hela dagen.",
    "Du är inte den vassaste kniven i lådan, va?",
    "Även Jad tycker synd om dig.",
    "Du har karismat av en blöt macka.",
    "Var du AFK när hjärncellerna delades ut?",
    "Om dåliga takes gav XP, hade du varit maxed för länge sedan.",
    "Du är det levande beviset på att vem som helst kan använda ett tangentbord.",
    "Någonstans saknar en by sin idiot… åh, hittade honom.",
    "Du ger alla så mycket glädje… när du går.",
    "Även en bronsdolk vore en uppgradering för dina takes.",
    "Brorsan loggade in bara för att göra bort sig.",
    "GE-skatten är smartare än dig.",
  ],

  // ── Norwegian ─────────────────────────────────────────────────────────
  norwegian: [
    "Du skriver som du spiller — sakte og forvirret.",
    "Jeg har sett bedre meninger fra en goblin.",
    "Du er grunnen til at duel arenaen ble fjernet.",
    "Hvis dumhet gjorde vondt, ville du skreket hele dagen.",
    "Du er ikke den skarpeste kniven i skuffen, vel?",
    "Selv Jad synes synd på deg.",
    "Du har karismaen til en våt sandwich.",
    "Var du AFK da hjernecellene ble delt ut?",
    "Hvis dårlige takes ga XP, hadde du vært maxed for lenge siden.",
    "Du er det levende beviset på at hvem som helst kan bruke et tastatur.",
    "Et eller annet sted savner en landsby idioten sin… å, fant ham.",
    "Du gir alle så mye glede… når du går.",
    "Selv en bronsedolk ville vært en oppgradering for dine takes.",
    "Bansen logget inn bare for å dumme seg ut.",
    "GE-skatten er smartere enn deg.",
  ],

  // ── Finnish ───────────────────────────────────────────────────────────
  finnish: [
    "Kirjoitat kuin pelaat — hitaasti ja hämmentyneenä.",
    "Olen nähnyt parempia mielipiteitä goblinilta.",
    "Sinä olet syy miksi duel arena poistettiin.",
    "Jos tyhmyys sattuisi, huutaisit koko päivän.",
    "Et ole terävimmästä päästä, vai mitä?",
    "Jopa Jad säälii sinua.",
    "Sinulla on märän voileivän karisma.",
    "Olitko AFK kun aivosoluja jaettiin?",
    "Jos huonot mielipiteet antaisivat XP:tä, olisit jo maxed.",
    "Olet elävä todiste siitä, että kuka tahansa voi käyttää näppäimistöä.",
    "Jossain kylä kaipaa idiottiaan… ai niin, löytyi.",
    "Tuot kaikille niin paljon iloa… kun lähdet.",
    "Jopa pronssitikari olisi parannus sinun mielipiteisiisi.",
    "Kaveri kirjautui sisään vain nolaamaan itsensä.",
    "GE-vero on sinua älykkäämpi.",
  ],

  // ── Turkish ───────────────────────────────────────────────────────────
  turkish: [
    "Oynadığın gibi yazıyorsun — yavaş ve kafası karışık.",
    "Bir goblinden daha iyi fikirler gördüm.",
    "Duel arenanın kaldırılma sebebi sensin.",
    "Aptallık acıtsaydı, bütün gün bağırırdın.",
    "Çekmecedeki en keskin bıçak değilsin, değil mi?",
    "Jad bile sana acıyor.",
    "Islak bir sandviçin karizması kadar karizman var.",
    "Beyin hücreleri dağıtılırken AFK miydin?",
    "Kötü fikirler XP verseydi, çoktan maxed olurdun.",
    "Herkesin klavye kullanabildiğinin yaşayan kanıtısın.",
    "Bir yerde bir köy aptalını arıyor… aa, buldum.",
    "Herkese çok mutluluk veriyorsun… gittiğinde.",
    "Bronz bir hançer bile senin fikirlerine upgrade olurdu.",
    "Kardeş sadece rezil olmak için giriş yaptı.",
    "GE vergisi senden daha akıllı.",
  ],

  // ── Arabic ────────────────────────────────────────────────────────────
  arabic: [
    "أنت تكتب مثل ما تلعب — ببطء وبحيرة.",
    "شفت آراء أحسن من غوبلن.",
    "أنت السبب إنهم شالوا الدويل أرينا.",
    "لو الغباء يوجع، كنت تصرخ طول اليوم.",
    "ما أنت أحد السكاكين في الدرج، صح؟",
    "حتى جاد يشفق عليك.",
    "عندك كاريزما ساندويتش مبلل.",
    "كنت AFK لما وزعوا خلايا المخ؟",
    "لو الآراء السيئة تعطي XP، كنت maxed من زمان.",
    "أنت دليل حي إن أي أحد يقدر يستخدم كيبورد.",
    "في مكان ما قرية تدور على غبيها… آه، لقيناه.",
    "تجيب فرحة للكل… لما تطلع.",
    "حتى خنجر برونزي يكون أبغريد لآرائك.",
    "الأخ سجل دخول بس عشان يفضح نفسه.",
    "ضريبة الـ GE أذكى منك.",
  ],

  // ── Romanian ──────────────────────────────────────────────────────────
  romanian: [
    "Scrii cum joci — încet și confuz.",
    "Am văzut păreri mai bune de la un goblin.",
    "Tu ești motivul pentru care au scos duel arena.",
    "Dacă prostia ar durea, ai țipa toată ziua.",
    "Nu ești cel mai ascuțit cuțit din sertar, nu?",
    "Până și Jad îi e milă de tine.",
    "Ai carisma unui sandviș ud.",
    "Erai AFK când s-au împărțit neuronii?",
    "Dacă părerile proaste ar da XP, ai fi maxed de mult.",
    "Ești dovada vie că oricine poate folosi o tastatură.",
    "Undeva un sat își caută idiotul… ah, l-am găsit.",
    "Aduci atâta bucurie tuturor… când pleci.",
    "Chiar și un pumnal de bronz ar fi un upgrade la părerile tale.",
    "Fratele s-a logat doar ca să se facă de râs.",
    "Taxa de GE e mai deșteaptă ca tine.",
  ],

  // ── Greek ─────────────────────────────────────────────────────────────
  greek: [
    "Γράφεις όπως παίζεις — αργά και μπερδεμένα.",
    "Έχω δει καλύτερες απόψεις από goblin.",
    "Εσύ είσαι ο λόγος που αφαιρέθηκε το duel arena.",
    "Αν η βλακεία πονούσε, θα φώναζες όλη μέρα.",
    "Δεν είσαι το πιο κοφτερό μαχαίρι στο συρτάρι, ε;",
    "Ακόμα και ο Jad σε λυπάται.",
    "Έχεις το χάρισμα ενός βρεγμένου σάντουιτς.",
    "Ήσουν AFK όταν μοίραζαν τα εγκεφαλικά κύτταρα;",
    "Αν οι κακές απόψεις έδιναν XP, θα ήσουν maxed εδώ και καιρό.",
    "Είσαι η ζωντανή απόδειξη ότι ο καθένας μπορεί να χρησιμοποιήσει πληκτρολόγιο.",
    "Κάπου ένα χωριό ψάχνει τον ηλίθιό του… α, τον βρήκαμε.",
    "Φέρνεις τόση χαρά σε όλους… όταν φεύγεις.",
    "Ακόμα και ένα χάλκινο στιλέτο θα ήταν αναβάθμιση.",
    "Ο τύπος συνδέθηκε μόνο για να ρεζιλευτεί.",
    "Ο φόρος του GE είναι πιο έξυπνος από σένα.",
  ],

  // ── Urdu ───────────────────────────────────────────────────────────────
  urdu: [
    "تم ایسے کھیلتے ہو جیسے تمہیں کسی نے سکھایا ہی نہیں۔",
    "تمہاری عقل اور تمہارا گیم پلے — دونوں غائب ہیں۔",
    "یار، تم سے تو گوبلن بھی بہتر کھیلتا ہے۔",
    "تمہارے دماغ کی بتی تو بجھی ہی رہتی ہے۔",
    "حد ہو گئی بھائی، اتنا برا کیسے کھیل سکتے ہو؟",
    "تم کھیلتے ہو یا بس اسکرین دیکھتے ہو?",
    "تمہاری اسٹریٹجی دیکھ کر تو دشمن بھی ہنستا ہے۔",
    "تمہیں کیبورڈ سے دور رہنا چاہیے — سب کی بھلائی کے لیے۔",
    "جب عقلیں بانٹی جا رہی تھیں تو تم AFK تھے۔",
    "تمہارے ٹیکس بھی تم سے زیادہ سمجھدار ہیں۔",
    "تمہاری gameplay دیکھ کر Jad کو بھی ترس آتا ہے۔",
    "تم نے لاگ ان صرف اپنی بےعزتی کے لیے کیا ہے۔",
    "اگر بری رائے XP دیتی تو تم کب کے maxed ہوتے۔",
    "تم گیم میں اتنے ہی کارآمد ہو جتنا صحرا میں چھتری۔",
    "بھائی تمہارا گیم پلے دیکھ کر تو ٹیوٹوریل آئلینڈ بھی شرمندہ ہے۔",
  ],

  // ── Irish English ─────────────────────────────────────────────────────
  ireland: [
    "Jaysus, did you learn to play from a turnip?",
    "You're about as useful as a chocolate fireguard, so you are.",
    "Even the sheep in Connemara have better game sense than you.",
    "You play like you've been on the Guinness all day — sloppy and making bad decisions.",
    "Your gameplay is as lost as a tourist driving on Irish country roads.",
    "The craic is mighty — but only because we're laughing at you.",
    "You couldn't find your way out of a roundabout, let alone the Wilderness.",
    "Even a wet day in Galway has more spark than your gameplay.",
    "Your takes are as flat as a pint that's been sitting out since last Tuesday.",
    "Ah here, would you ever cop on? That was embarrassing.",
    "You've got the fighting spirit of a deflated football.",
    "Even the Luas runs smoother than your PvP — and that's saying something.",
    "Temple Bar tourists have more game sense than you, and they're hammered.",
    "You play like someone who's never left the parish.",
    "Your strategy is about as reliable as Irish Rail on a bank holiday.",
    "You've the coordination of a newborn calf on ice.",
    "Sure look, at least you're consistent — consistently shite.",
    "Even the potholes on the N17 have more depth than your gameplay.",
    "You couldn't tackle a bag of crisps, never mind another player.",
    "Grand so — if by grand you mean absolutely woeful.",
    "Your ma should've swallowed, and I say that with all the love in Ireland.",
    "You've got the look of a fella who was dropped as a baby and bounced twice.",
    "Your family tree is a bush and even the bush is embarrassed.",
    "Jaysus, you've the personality of a wet field in Roscommon.",
    "You're the reason the English thought they could take Ireland — they looked at you and thought 'can't be that hard.'",
    "Even the famine couldn't produce something as empty as your skull.",
    "You were born on a Wednesday — the nurses took one look and said 'ah here.'",
    "The only thing thicker than your accent is your head.",
    "Even Father Ted was a better priest than you are a player, and he was fictional and shite.",
    "You've got the charm of a flat Smithwick's left out since Paddy's Day.",
    "Your gameplay is like the weather in Donegal — nobody chooses it voluntarily.",
    "You're the worst export Ireland has ever produced, and we exported famine ships.",
    "If bullshit was currency you'd be the richest man in Dublin.",
    "Even Dustin the Turkey had more talent, and he's a bloody puppet.",
    "Your da probably has a better K/D ratio and he thinks the internet is a type of fishing net.",
    "They say the Irish are fighters. They clearly hadn't met you.",
    "You'd lose a fight with a bag of Tayto.",
    "The Book of Kells has been around for 1200 years and it's still more relevant than you.",
    "You're about as useful as a glass hammer at a house clearance.",
    "Your ma should've left you at the church door, but even God would've returned you.",
    "You look like something the tide washed up in Galway and nobody claimed.",
    "If your da knew what you'd turn out like, he'd have pulled out and aimed at the curtains.",
    "You're the load that should've ended up in a tissue in a B&B in Killarney.",
    "Your family tree is so rotten even the woodworm left.",
    "If you were any thicker they'd put a hi-vis on you and use you as a bollard on the M50.",
    "Even the famine survivors had more meat on them than your personality.",
    "You're the proof that the Brits weren't the worst thing to happen to Ireland.",
    "If your organs were donated, the surgeon would take one look and throw them in the bin.",
    "Your funeral would just be people checking their phones.",
    "Even the banshees wouldn't bother wailing for you — you're not worth the effort.",
    "If you drowned in the Liffey, the fish would file a complaint.",
    "Your existence makes a strong case for retroactive abortion.",
    "You're the reason Irish people drink — someone has to forget you exist.",
    "Your ma's been passed around more than the collection plate at Sunday mass.",
    "You look like something that crawled out of the Liffey and nobody claimed.",
    "The only ride you've ever had is the Dart and even that was delayed.",
    "If shagging sheep was legal, you'd still be single in rural Ireland.",
    "You smell like a pub carpet in Temple Bar — sticky, stale, and full of other people's mistakes.",
    "Your knob hasn't seen action since the Celtic Tiger and even that was a brief boom.",
    "You couldn't score in a brothel with a winning lottery ticket.",
    "Your mum's got more mileage than a Bus Eireann coach and she's less reliable.",
    "Even Father Ted would refuse to give you the last rites — waste of holy water.",
    "If they DNA tested half of Galway, your da would owe a fortune in child support.",
    "You look like a police composite sketch of every lad barred from Coppers.",
    "Your dating profile just says 'please' and even that doesn't work.",
    "The only thing that's ever gone down on you is your internet connection.",
    "Your bedroom is drier than the Sahara and sadder than a wet Tuesday in Leitrim.",
    "You're the human equivalent of a flat pint of Smithwick's — nobody wants you.",
  ],

  // ── Irish-Urdu mix (for the bilingual lad) ────────────────────────────
  'ireland-urdu': [
    "Jaysus, did you learn to play from a turnip?",
    "تم ایسے کھیلتے ہو جیسے تمہیں کسی نے سکھایا ہی نہیں۔",
    "You're about as useful as a chocolate fireguard, so you are.",
    "تمہاری عقل اور تمہارا گیم پلے — دونوں غائب ہیں۔",
    "Even the sheep in Connemara have better game sense than you.",
    "یار، تم سے تو گوبلن بھی بہتر کھیلتا ہے۔",
    "You play like you've been on the Guinness all day — sloppy and making bad decisions.",
    "تمہارے دماغ کی بتی تو بجھی ہی رہتی ہے۔",
    "The craic is mighty — but only because we're laughing at you.",
    "حد ہو گئی بھائی، اتنا برا کیسے کھیل سکتے ہو؟",
    "Ah here, would you ever cop on? That was embarrassing.",
    "تم کھیلتے ہو یا بس اسکرین دیکھتے ہو?",
    "Your takes are as flat as a pint that's been sitting out since last Tuesday.",
    "تمہاری اسٹریٹجی دیکھ کر تو دشمن بھی ہنستا ہے۔",
    "Even the Luas runs smoother than your PvP — and that's saying something.",
    "جب عقلیں بانٹی جا رہی تھیں تو تم AFK تھے۔",
    "Sure look, at least you're consistent — consistently shite.",
    "تمہاری gameplay دیکھ کر Jad کو بھی ترس آتا ہے۔",
    "Grand so — if by grand you mean absolutely woeful.",
    "اگر بری رائے XP دیتی تو تم کب کے maxed ہوتے۔",
    "You couldn't tackle a bag of crisps, never mind another player.",
    "بھائی تمہارا گیم پلے دیکھ کر تو ٹیوٹوریل آئلینڈ بھی شرمندہ ہے۔",
    "Temple Bar tourists have more game sense than you, and they're hammered.",
    "تمہیں کیبورڈ سے دور رہنا چاہیے — سب کی بھلائی کے لیے۔",
    "You've the coordination of a newborn calf on ice.",
    "تم گیم میں اتنے ہی کارآمد ہو جتنا صحرا میں چھتری۔",
    "Even the potholes on the N17 have more depth than your gameplay.",
    "تمہارے ٹیکس بھی تم سے زیادہ سمجھدار ہیں۔",
    "Your strategy is about as reliable as Irish Rail on a bank holiday.",
    "تم نے لاگ ان صرف اپنی بےعزتی کے لیے کیا ہے۔",
    // ── Dark Irish additions ──
    "Your ma should've swallowed, and I say that with all the love in Ireland.",
    "تمہارے والدین تمہیں دیکھ کر سوچتے ہوں گے — کہاں غلطی ہوئی۔",
    "You've got the look of a fella who was dropped as a baby and bounced twice.",
    "تمہاری فیملی ٹری ایک جھاڑی ہے اور جھاڑی بھی شرمندہ ہے۔",
    "The only thing thicker than your accent is your head.",
    "اگر دماغ بارود ہوتا تو تمہارے پاس ناک صاف کرنے کو بھی نہ ہوتا۔",
    "Even Father Ted was a better priest than you are a player, and he was fictional and shite.",
    "تم ارتقاء کا الٹا ثبوت ہو — بندر تم سے بہتر تھا۔",
    "You're the worst export Ireland has ever produced, and we exported famine ships.",
    "تمہاری پیدائش کا سرٹیفکیٹ کنڈوم فیکٹری کا معافی نامہ ہے۔",
    "If bullshit was currency you'd be the richest man in Dublin.",
    "خدا نے تمہاری شکل پر اتنا وقت لگایا کہ دماغ ڈالنا بھول گیا۔",
    "Even Dustin the Turkey had more talent, and he's a bloody puppet.",
    "تمہارا آئینا بھی تمہیں دیکھ کر مایوس ہو جاتا ہے۔",
    "They say the Irish are fighters. They clearly hadn't met you.",
    "تم اس دنیا کے سب سے بڑے بیوقوف نہیں ہو، لیکن دعا کرو وہ مرے نہیں۔",
    "You'd lose a fight with a bag of Tayto.",
    "تمہاری موجودگی پیدائشی کنٹرول کی بہترین دلیل ہے۔",
    "The Book of Kells has been around for 1200 years and it's still more relevant than you.",
    "کہیں ایک درخت تمہارے لیے آکسیجن بنانے میں لگا ہے — اس سے معافی مانگو۔",
    // ── Dark mix additions ──
    "If your mum could go back in time she'd have swallowed instead.",
    "تمہاری ماں کو تمہیں پیدا کرنے کی بجائے کتا پالنا چاہیے تھا۔",
    "Your funeral would have better craic than your life ever did.",
    "تمہاری زندگی اگر فلم ہوتی تو لوگ ری فنڈ مانگتے۔",
    "Even the banshees wouldn't waste a scream on you.",
    "اگر تمہارے اعضاء عطیہ کیے جائیں تو ڈاکٹر انہیں کوڑے دان میں پھینکے۔",
    "If your life support got switched off, nobody would even notice.",
    "تم اتنے بیکار ہو کہ قبرستان بھی تمہیں جگہ نہ دے۔",
    "Your da left and honestly, fair play to him.",
    "تمہاری شکل دیکھ کر تمہارا آئینا بھی استعفیٰ دے دے۔",
    "You're what happens when God gets distracted halfway through making someone.",
    "تمہاری موت پر سب سے زیادہ لوگ پارکنگ کے لیے آئیں گے، ماتم کے لیے نہیں۔",
    "If they scattered your ashes in the Liffey, even the river would file a complaint.",
    "اگر بیوقوفی سے مرتے تو تم کب کے جا چکے ہوتے۔",
    "Jaysus, even the devil would reject your soul — not worth the paperwork.",
    "تمہاری پیدائش دنیا کے لیے سب سے بڑی غلطی تھی — COVID سے بھی بری۔",
    // ── Ultra dark mix ──
    "Your ma's been ridden more than the Luas Green Line.",
    "تمہاری امی کو تم سے زیادہ تو واشنگ مشین خوش کرتی ہے۔",
    "You couldn't score in a brothel with a fistful of fifties, ya useless prick.",
    "تمہارا لنڈ اتنا چھوٹا ہے کہ خوردبین بھی تلاش کرتے تھک جائے۔",
    "Even your right hand is thinking of seeing other people.",
    "تمہاری شکل دیکھ کر تمہاری امی نے دوبارہ بچہ نہ پیدا کرنے کی قسم کھائی۔",
    "The only thing you've ever turned on is a kettle.",
    "تم اتنے بدصورت ہو کہ تمہارا ہاتھ بھی تمہیں ریجیکٹ کر دے۔",
    "Your search history would get you barred from every country, not just Ireland.",
    "تمہاری سیکس لائف صحرا سے بھی زیادہ خشک ہے۔",
    "If your bedroom walls could talk, they'd just say 'it's so quiet in here.'",
    "تمہارے بستر پر اتنی خاک جمی ہے کہ آثار قدیمہ والے کھدائی شروع کر دیں۔",
    "Jaysus, even the sheep in Connemara run faster when they see YOU coming.",
    "اگر بیوقوفی ایک بیماری ہوتی تو تم آخری سٹیج پر ہوتے۔",
    "Your love life makes the Irish famine look like a feast.",
    "تمہیں دیکھ کر خدا نے بھی کہا — میری سب سے بڑی غلطی۔",
  ],

  // ── Russian ───────────────────────────────────────────────────────────
  russian: [
    "Ты печатаешь как играешь — медленно и растерянно.",
    "Я видел лучшие мнения от гоблина.",
    "Ты причина, по которой убрали дуэль арену.",
    "Если бы глупость причиняла боль, ты бы кричал весь день.",
    "Ты не самый острый нож в ящике, да?",
    "Даже Джад тебя жалеет.",
    "У тебя харизма мокрого бутерброда.",
    "Ты был AFK когда раздавали мозги?",
    "Если бы плохие мнения давали XP, ты бы давно был maxed.",
    "Ты живое доказательство, что любой может пользоваться клавиатурой.",
    "Где-то деревня ищет своего дурака… а, нашла.",
    "Ты приносишь всем столько радости… когда уходишь.",
    "Даже бронзовый кинжал был бы апгрейдом для твоих мнений.",
    "Братан залогинился только чтобы опозориться.",
    "Налог GE умнее тебя.",
  ],

  // ── American ───────────────────────────────────────────────────────────
  america: [
    "Bro skipped the gym, the salad bar, and apparently the tutorial.",
    "You play like you eat — no strategy, just shoving everything in.",
    "Your gameplay is as wide as your waistline.",
    "Even your character can't carry as much as you weigh.",
    "Freedom isn't free, but your deaths sure are — you hand them out like candy.",
    "You've got the portion size of a country that super-sized itself into obesity.",
    "Mate, your BMI is higher than your total level.",
    "You move in-game about as fast as you move in real life — barely.",
    "Even a bald eagle would be embarrassed to represent you.",
    "Your healthcare can't fix your gameplay, and neither can anything else.",
    "You're built like a run energy bar stuck at zero.",
    "If sweating counted as XP you'd be maxed by now.",
    "The only thing you're grinding is your chair into dust.",
    "Your reaction time is slower than a McDonald's drive-through at 2am.",
    "You play like someone who thinks ranch is a food group.",
    "Even your prayer would drain faster from carrying all that weight.",
    "You've got the agility level of a mobility scooter.",
    "The only running you do is running your mouth.",
    "Your gameplay is as bloated as an American portion size.",
    "NASA put a man on the moon but nothing can launch your gameplay into orbit.",
    "Land of the free, home of the brainless — at least in your case.",
    "Your KD ratio and your step count have something in common — both are tragic.",
    "Even a bald eagle wouldn't claim you.",
    "You use more energy typing excuses than you do actually playing.",
    "Your gear is the only thing about you that isn't oversized.",
    "Your family tree is just a cactus — it's prickly and everyone on it is a prick.",
    "You've got the life expectancy of someone who can't afford their insulin.",
    "Your gameplay is the only thing worse than the American education system, and that's saying something.",
    "If school shootings counted as extracurriculars, your country would finally have achievers.",
    "You're built like someone who lists 'competitive eating' as a sport.",
    "Your ancestors fought for freedom. You use it to be shit at video games.",
    "You've got the physique of a bean bag chair and the intellect to match.",
    "Your country can't even give you healthcare and you still chose to be THIS unhealthy?",
    "You eat like every meal is your last, and with that diet, it might be.",
    "If your gameplay were a school report, it would just say 'see me.'",
    "You've got more chins than a Chinese phone book.",
    "Your mobility scooter has more horsepower than your brain.",
    "NASA launched rockets into space. Your parents launched a disappointment into the world.",
    "The only six-pack you'll ever see is the one in your fridge.",
    "You probably think salad is a type of punishment.",
    "Your blood type is ranch dressing.",
    "Even your shadow needs a rest after following you around.",
    "You breathe heavy just reading this message, don't you?",
    "The founding fathers would take one look at you and ask for British rule back.",
    "You're the reason other countries make fun of Americans.",
    "Your heart works harder carrying you than you've ever worked at anything.",
    "You peaked in the womb — it's been a steady decline since.",
    "Your credit score and your IQ are in a race to the bottom.",
    "Even Walmart greeters look at you with pity.",
    "Your mum should've swallowed — would've been higher in protein and lower in disappointment.",
    "If your dad had pulled out, America's average IQ would've gone up.",
    "You're the poster child for why some animals eat their young.",
    "If you were any fatter you'd have your own gravitational pull and your own postcode.",
    "Your arteries are working harder than you've ever worked at anything in your miserable life.",
    "You'll die on the toilet like Elvis, except nobody will write songs about you.",
    "Your life expectancy is shorter than your attention span, and your attention span is dogshit.",
    "If you were on fire in a Walmart car park, people would roast marshmallows.",
    "Your funeral will be closed casket — not out of respect, just because nobody wants to look at you.",
    "Even your coffin will need to be wide-load shipped.",
    "If God made you in his image, he must've been having a really bad day.",
    "Your mum looks at your baby photos and wishes she'd had a miscarriage.",
    "The only exercise you get is jumping to conclusions and running your mouth.",
    "You'll be found dead surrounded by empty pizza boxes and nobody will be surprised.",
    "Your bloodline is just high fructose corn syrup at this point.",
    "You sweat gravy and breathe disappointment.",
    "If they cremated you, the grease fire would last for days.",
    "Even Make-A-Wish wouldn't waste a wish on you.",
    "Your family tree is just a list of people who peaked in high school.",
    "You're what happens when a deep-fried Twinkie gains sentience and develops depression.",
    "The only six-pack you'll ever have is the one wedged between your third and fourth chin.",
    "Your mum sat on a scale and it said 'to be continued.'",
    "You sweat butter and cry ranch dressing.",
    "The only time you see your dick is in a mirror, and even then you need binoculars.",
    "If diabetes was a personality trait you'd finally have one.",
    "Your arteries have more blockages than the M25 and less chance of being cleared.",
    "You look like someone microwaved a thumb and gave it a Discord account.",
    "Your mum's vagina had a revolving door installed and you were the worst thing to come out of it.",
    "If your family was any more inbred, Subway would sell them as a footlong.",
    "You eat pussy the same way you do everything else — poorly and out of breath.",
    "Your tits are bigger than most women's and somehow still less attractive.",
    "The only running you've done is running a tab at McDonald's.",
    "If they cut you open, your blood would just be Mountain Dew and sadness.",
    "Your search history would make a jury physically recoil.",
    "You look like you sweat when you eat cereal.",
    "The only workout you get is wiping your arse — and even that leaves you breathless.",
    "Your belly button collects enough lint to knit a sweater.",
    "Even your toilet is scared of you.",
  ],

  // ── Canadian ───────────────────────────────────────────────────────────
  canada: [
    "You apologise after every death, don't you? Sorry doesn't fix your gameplay, bud.",
    "You play like Canadian internet — laggy, unreliable, and overpriced.",
    "Even a Canadian goose has more fight in it than you.",
    "Your gameplay is as cold and empty as northern Manitoba.",
    "Tim Hortons coffee has more kick than your DPS.",
    "You're the hockey player that sits in the penalty box the entire game — useless.",
    "Maple syrup flows faster than your reaction time.",
    "Even a moose on ice has better footwork than you.",
    "You play like the Leafs — decades of disappointment and counting.",
    "Your takes are as bland as a poutine without the gravy.",
    "Bro really typed 'sorry' after getting one-ticked. Classic Canadian.",
    "The only thing you're good at is being politely terrible.",
    "You've got the aggression of a beaver and the skill of a log.",
    "Your gameplay is like a Canadian winter — long, painful, and everyone wants it to end.",
    "Even the CN Tower has seen fewer disasters than your PvP career.",
    "You play like you're still waiting for your igloo's WiFi to connect.",
    "Eh? More like meh. That sums up your entire gameplay.",
    "The only 99 you'll ever see is Gretzky's jersey, not your stats.",
    "Your strategy is as lost as someone driving through Saskatchewan — flat and going nowhere.",
    "You couldn't hit a spec if it was the size of Lake Ontario.",
    "Letterkenny characters are fictional and they'd still clap you in PvP.",
    "Even a Mountie on horseback moves faster than your switches.",
    "You bring the same energy as a Tim Hortons that's run out of Timbits.",
    "Your gameplay is the reason Canadians apologise — someone has to say sorry for it.",
    "Bieber came from Canada too, and somehow you're still more embarrassing.",
    "Your family tree is a telephone pole — straight, wooden, and everyone's hung up on it.",
    "You're the reason nobody takes Canada seriously.",
    "Even your 'sorry' sounds pathetic. Everything about you is pathetic.",
    "You've got the personality of unseasoned chicken, which tracks for a Canadian.",
    "Your gameplay is colder than your personality, and your personality is already at absolute zero.",
    "You're the human equivalent of a Tim Hortons that switched to garbage coffee — a massive downgrade nobody asked for.",
    "The only thing more frozen than your brain is your country for six months of the year.",
    "Even a Canadian goose would stomp you out, and they stomp everyone, so that's not special.",
    "Your parents apologise for you more than Canadians apologise for anything.",
    "You're the disappointment that Thanksgiving dinner in Canada was invented to distract from.",
    "The Leafs at least make the playoffs sometimes. You can't even make a good point.",
    "Your birth certificate should just say 'we're sorry' in both official languages.",
    "You've got the charisma of a snowbank in Winnipeg — cold, grey, and everybody walks around you.",
    "You'd lose a fight to a baby seal, and up there that's embarrassing.",
    "Canada gave us insulin, peacekeeping, and you — two out of three ain't bad.",
    "You bring the same energy as a power outage in Nunavut — dark and nobody cares.",
    "Even the French Canadians and English Canadians agree on one thing — you're useless.",
    "Your future is as empty as the prairies and twice as depressing.",
    "Somewhere a moose is more culturally significant than you. Actually, all moose are.",
    "Your mum should've left you on an ice floe and let nature sort it out.",
    "If your dad had any sense he'd have finished into a snowbank instead.",
    "You're the reason Canada has such a high suicide rate — people would rather die than deal with you.",
    "If you were on fire, people would say sorry to the fire for having to touch you.",
    "Your life is as pointless as a screen door on a submarine, and twice as useless.",
    "Even the bears would spit you out — not enough substance.",
    "Your funeral would just be people saying 'sorry for your loss' and meaning the oxygen you wasted.",
    "If they scattered your ashes in Lake Ontario, the fish would emigrate.",
    "You're living proof that God occasionally makes something just to fill space.",
    "Even the northern lights would dim in embarrassment if they knew you existed.",
    "Your mum tells people you're in witness protection. Easier than admitting you're her kid.",
    "If your brain was put in a bird, the bird would fly backwards.",
    "You're the human equivalent of freezer burn — useless, unwanted, and a waste of space.",
    "Your bloodline has all the diversity of a glass of milk and all the personality to match.",
    "Even a Canadian winter has more warmth than your personality.",
    "You look like you were conceived in a Tim Hortons toilet during a blizzard.",
    "Your mum's been through more Canadians than a border crossing.",
    "The only thing you've ever mounted is a snowbank, and you were drunk.",
    "You couldn't score if the net was the size of Lake Superior.",
    "Your knob gets less use than a lifeguard in Winnipeg in January.",
    "If pathetic had a passport it would be Canadian and have your photo in it.",
    "You smell like a zamboni fart — cold, wet, and nobody wants to be near it.",
    "Your love life is colder than Yellowknife and twice as empty.",
    "Even a Canadian goose would rather shit on you than shag you.",
    "Your mum puts maple syrup on everything. Your dad put his dick in everything. You got neither talent.",
    "The only wood you've ever seen is the hockey stick, and even that has more personality.",
    "If they checked your browser history, you'd be deported to an even colder country — if one exists.",
    "Your right hand is doing more overtime than a Tim Hortons employee during Roll Up the Rim.",
    "You've got the sex appeal of a frozen moose carcass.",
    "You look like the 'after' picture of a Canadian winter — beaten, grey, and nobody wants to see it.",
  ],

  // ─────────────────────────── UK REGIONS ─────────────────────────────────

  // ── Cambridge ─────────────────────────────────────────────────────────
  cambridge: [
    "Imagine going to a city full of geniuses and still being the thickest one there.",
    "You've got all of Cambridge's arrogance and none of the brains.",
    "Even the punters on the Cam have better direction than you.",
    "Cambridge educated and you still can't figure out basic game mechanics?",
    "The only thing you're graduating from is embarrassment.",
    "All that knowledge in Cambridge and it clearly skipped your house.",
    "You punt through life the same way you play — going in circles.",
    "Even a first-year would outplay you.",
    "Big university city, small brain energy.",
    "You're proof that living near a good uni doesn't make you smart.",
    "The bikes in Cambridge have more sense of direction than you.",
    "Mate you'd fail an interview at McDonald's, never mind a Cambridge college.",
    "King's College called — they want nothing to do with you.",
    "You navigate the GE like a tourist navigates Cambridge — badly.",
    "Even the ducks on the Cam could PK better than you.",
    "Cambridge rejected your application and honestly, life should have too.",
    "Your parents wasted their money on your education — assuming you even had one.",
    "You've got the intellectual capacity of a punt pole stuck in mud.",
    "The only degree you're getting is third-degree embarrassment.",
    "Even the homeless bloke outside Sainsbury's has a better life plan than you.",
    "Your DNA is the only thing about you that's double-helix — everything else is single-digit.",
    "If your gameplay was a dissertation it would be rejected for lack of substance.",
    "You make the tourists look competent, and they're walking into cyclists.",
    "The Cam has more depth in a puddle than you have in your entire existence.",
    "You're what happens when a Cambridge education meets a Luton upbringing.",
    "Even the porters would refuse you entry — to the server, not just the college.",
    "Your mother drinks in the Spoons on Regent Street and brags about you. Nobody believes her.",
    "You peaked at GCSE and it's been downhill ever since.",
    "The Mathematical Bridge was built without bolts. Your argument was built without logic.",
    "Stephen Hawking rolled through Cambridge with more game than you'll ever have.",
    "Parker's Piece has seen better performances from dogs chasing frisbees.",
    "You're the kind of person who gets lost in the Grand Arcade.",
    "Even Mill Road on a Friday night has more class than you.",
    "Your gameplay makes Anglia Ruskin look like Oxford.",
    "Kettle's Yard has more life in its still-life paintings than you show in PvP.",
    "You'd struggle to get into ARU, let alone a Cambridge college.",
    "The Round Church has seen sinners with more redeeming qualities than you.",
    "Even the cows on the commons have better situational awareness.",
    "You're not even the smartest person in this Discord, and the bar is underground.",
    "Your mum should've punted you down the Cam as a baby and let nature take its course.",
    "Cambridge has world-changing minds. Then there's you — proof that exceptions exist.",
    "Your existence is the strongest argument against reproducing that Cambridge has ever produced.",
    "If your brain was donated to science, they'd send it back — insufficient material.",
    "You look like the 'before' picture in a documentary about failed genetic experiments.",
    "Even the grave robbers at old Cambridge colleges wouldn't dig you up — not worth the effort.",
    "Your bloodline ends with you, and honestly that's a public service.",
    "You've got the survival instincts of a lemming and the intellect to match.",
    "If you were on life support, I'd unplug you to charge my phone.",
    "You're the kind of person organ donors are wasted on.",
    "Your parents spend Christmas telling people you died. It's easier than explaining you.",
    "Darwin would use you as proof that natural selection isn't working fast enough.",
    "You're the strongest argument for eugenics the world has ever seen.",
    "Even the Cam would spit you back out.",
    "You look like you were conceived in a punt and it shows — wet, unstable, and going nowhere.",
    "Your mum spread her legs wider than the Mathematical Bridge and produced something less useful.",
    "You're the cum stain on Cambridge's otherwise clean reputation.",
    "If wanking counted as a degree you'd finally have a First.",
    "You couldn't pull a pint let alone a person.",
    "Your face would make Corpus Clock stop ticking out of sheer horror.",
    "You look like a clinical trial that should've been terminated early.",
    "The only thing smaller than your brain is your dick — and both are disappointing.",
    "You're so ugly Grindr would refund your subscription.",
    "You smell like the River Cam at low tide — stagnant and foul.",
    "If brains were arseholes, you'd have diarrhoea of the mouth permanently.",
    "Your bloodline is thinner than the Cam in a drought.",
    "Even the sex workers in Cambridge would give you a refund.",
    "You're what falls out when you shake Cambridge's family tree.",
    "King's College Chapel has stained glass windows more transparent than your bullshit.",
  ],

  // ── Birmingham ────────────────────────────────────────────────────────
  birmingham: [
    "You've got the Brummie accent AND the Brummie brain — god help us.",
    "Even the Bullring couldn't polish you up.",
    "Bro's from Birmingham and it shows.",
    "You play RuneScape like you navigate Spaghetti Junction — absolute chaos.",
    "The only thing flatter than your DPS is your personality.",
    "Peaky Blinders wouldn't even let you hold their caps.",
    "Your takes are as dull as a wet Tuesday in Digbeth.",
    "All that Brum grit and you still can't land a spec.",
    "You'd get lost on a straight road in Birmingham, let alone the Wilderness.",
    "Even the number 11 bus has a better route than your gameplay.",
    "Cadbury makes sweet things in Brum — clearly you're not one of them.",
    "The accent was bad enough, did you have to bring the gameplay too?",
    "You're the human equivalent of roadworks on the M6.",
    "Villa would sign you — they love a player that disappoints.",
    "Birmingham's finest? Birmingham's finished, more like.",
    "Your mum met your dad at a family reunion in Brum and it shows.",
    "You've got the charm of a kebab wrapper blowing down Broad Street at 3am.",
    "Your gene pool is shallower than the canal in Brindleyplace.",
    "Peaky Blinders had brains. You've got the blinders part nailed though — totally blind to how shit you are.",
    "Even the crackheads in Digbeth have a better game plan.",
    "Your family tree doesn't fork, it's a straight line — like the M6 through your IQ.",
    "You're the reason they put railings on overpasses in Birmingham.",
    "Star City has more stars than your future ever will.",
    "If Birmingham had an anus, your gameplay would be what comes out of it.",
    "Even New Street Station during rush hour is less of a trainwreck than you.",
    "You bring the same vibes as a shuttered Wetherspoons in Erdington.",
    "The Rotunda has more going on at the top than your skull does.",
    "Your personality is as empty as the shops in the Pallasades.",
    "You're the Coventry of Birmingham — everyone forgets you exist.",
    "Your mum should've flushed you down the toilet in the Bullring and no one would've noticed.",
    "If your family tree had any more incest in it, it'd be from Stoke.",
    "You're the reason Birmingham has a higher crime rate — existing near you is a punishment.",
    "If you were on fire, I wouldn't even waste my piss putting you out.",
    "Your bloodline has been going downhill since the industrial revolution.",
    "You look like something that crawled out of a canal in Selly Oak.",
    "If they put you down like a sick dog, nobody in Brum would even notice you were gone.",
    "Your mum tells people she's got two kids. You're the third.",
    "Even the smackheads in Handsworth have more going for them than you.",
    "You're the human equivalent of a derelict building in Aston — abandoned and condemned.",
    "If organ donation was compulsory, yours would be the rejects.",
    "Your existence single-handedly brings down the property value in the entire West Midlands.",
    "You make the Rotunda look attractive, and it's a concrete cylinder.",
    "Your personality would make a parasite uncomfortable.",
    "Your mum's been passed around Broad Street more times than a pint glass.",
    "You look like you were scraped off the floor of Snobs nightclub.",
    "The only thing dirtier than the canals in Brum is your search history.",
    "If being a waste of oxygen was a career you'd be CEO.",
    "Your face would make the concrete cows in Milton Keynes look attractive.",
    "You smell like the back of the 11A bus on a hot day.",
    "You couldn't pull a Christmas cracker let alone a bird.",
    "Your knob is the only thing about you smaller than your IQ.",
    "Your mum's got more miles on her than the number 50 bus to Moseley.",
    "The only ring you'll ever see is the one around the bath in your council flat.",
    "You're so ugly even Handsworth wouldn't claim you.",
    "If they DNA tested your family they'd find a concerning amount of overlap.",
    "You look like a police e-fit of a sex offender.",
    "Your dating profile is just a public service warning.",
    "Even the rats in the Bullring wouldn't shag you.",
  ],

  // ── Leeds ─────────────────────────────────────────────────────────────
  leeds: [
    "Leeds lad and it painfully shows.",
    "You play like Leeds United — all hype, no results.",
    "Marching on together? Mate, no one wants to march with you.",
    "You couldn't find your way out of the Corn Exchange, let alone the Wilderness.",
    "Even a seagull nicking chips in Leeds city centre has better strategy than you.",
    "Your gameplay is as reliable as Leeds getting promoted.",
    "Bielsa couldn't even coach you into being decent.",
    "You're about as useful as an umbrella in Leeds — always needed, never working.",
    "The only consistent thing about you is how bad you are.",
    "They should rename Roundhay Park to Round-here's-an-idiot Park when you visit.",
    "You've got the Yorkshire stubbornness but none of the Yorkshire wit.",
    "Kirkgate Market has stalls smarter than you.",
    "You're the human equivalent of the Leeds weather — grey and depressing.",
    "Even the Leeds Rhinos would drop you from the squad.",
    "Tha's about as sharp as a wet pudding, lad.",
    "Your family tree doesn't branch — it's just a stick, like everything else in Leeds.",
    "You've got the look of someone conceived in a Wetherspoons toilet in Headingley.",
    "Even the rats in the Merrion Centre have better survival instincts.",
    "Your mum still tells people you're 'finding yourself.' You've been lost since birth.",
    "If Leeds had a face, it would be yours — and that's not a compliment.",
    "You're the kind of bloke who gets barred from Oceana for being too embarrassing.",
    "Your future is as dark as the arches under Leeds station.",
    "Even the Call Lane bins have more substance inside them than you.",
    "Chapeltown has more prospects than your gameplay career.",
    "You've got the intelligence of a bollard on the Headrow.",
    "Your birth was a clearance event and nobody showed up.",
    "Briggate shoppers step over more interesting things than you.",
    "You peaked in year 7 and it was still a low point.",
    "Even Hyde Park Corner at 3am has more going for it than you.",
    "If your mum had the choice again she'd throw you in the Aire and walk away.",
    "Your bloodline has peaked and it was still at sea level.",
    "You're the reason people think Yorkshire is full of inbreds.",
    "If you were on fire in the middle of Briggate, people would film it and laugh.",
    "Even the corpses in Lawnswood Cemetery have a brighter future than you.",
    "Your mum tells her friends you moved abroad. You're in the next room.",
    "You look like you were assembled from rejected parts at the Leeds General Infirmary.",
    "If they turned off your life support, the biggest loss would be the electricity.",
    "Your existence is the worst thing to happen to Leeds since the M621.",
    "You're the kind of person who lowers property values just by breathing nearby.",
    "Darwin would weep at the sight of you. Evolution failed.",
    "You make the Kirkgate Market rats look charming in comparison.",
    "If your organs were donated, the NHS would bin them.",
    "Your parents divorce rate is lower than their combined IQ, and they're still married.",
    "Your mum's been through more men than Leeds station has trains.",
    "You look like you were conceived behind the bins at Pryzm.",
    "If they swabbed your family tree for DNA, the results would just say 'yikes'.",
    "The only head you've ever given is a headache.",
    "You smell like Kirkgate Market on a hot August day — rotten and repulsive.",
    "You couldn't pull a muscle let alone a woman.",
    "Your bedroom has seen less action than a closed-down Blockbusters.",
    "You look like a walking argument for chemical castration.",
    "Even your right hand files for divorce.",
    "You've got the sex appeal of a burst bin bag on the Headrow.",
    "If there was a vaccine for your personality, people would actually queue for it.",
    "Your knob gets more use as a pencil rest than anything else.",
    "Even the pigeons in City Square would rather shit on someone else.",
    "You were the last one picked — not for teams, for existence.",
    "Your mum wished she'd sat on a washing machine instead.",
  ],

  // ── Stoke ─────────────────────────────────────────────────────────────
  stoke: [
    "You're from Stoke. That's the roast. That's it.",
    "Even the pottery in Stoke has more personality than you.",
    "Can Stoke do it on a cold rainy night? Apparently you can't do it anywhere.",
    "Your gameplay is as inspiring as the Stoke-on-Trent skyline.",
    "Stoke City has had a rough time, but at least they're not as bad as you.",
    "Bro really said 'I'm from Stoke' like that's something to be proud of.",
    "You're the oatcake of people — bland and forgettable.",
    "Peter Crouch did robot celebrations. You just play like a robot with no batteries.",
    "The Potteries produced fine china. You? You're more like a chipped mug from Poundland.",
    "Mate, Alton Towers is nearby and even they couldn't make you thrilling.",
    "Even Stoke bus station has more going on than your gameplay.",
    "Bet365 wouldn't even take odds on you winning.",
    "Tony Pulis couldn't organise a defence as shambolic as your gameplay.",
    "You bring the same energy as the A500 at rush hour — going nowhere slowly.",
    "Your only achievement is making Stoke look even worse.",
    "You're from Stoke. Your postcode is already an insult.",
    "Your parents met at a family do in Hanley and the gene pool has never recovered.",
    "You've got the sex appeal of a boarded-up shop in Burslem.",
    "If Stoke is the armpit of England, you're the smell.",
    "Even the pigeons in Hanley town centre have a better quality of life.",
    "Your mum puts 'Stoke-on-Trent' on her Tinder and still gets more matches than you get kills.",
    "You've got the ambition of a pothole on the A50.",
    "The monkey dust problem in Stoke is less damaging than your gameplay.",
    "Festival Park is the highlight of Stoke, and it's a retail park. That tells you everything.",
    "Your gameplay is what happens when you raise a child on nothing but oatcakes and disappointment.",
    "Even the abandoned Spode factory has more life in it than you.",
    "Port Vale would reject you, and they'll take literally anyone.",
    "Trentham Gardens is beautiful. You're the opposite of Trentham Gardens.",
    "You make Stoke's tourist board want to give up entirely.",
    "Your mother should've thrown you in a kiln and let the Potteries deal with you.",
    "You look like something that was incorrectly fired in a Stoke factory — cracked and worthless.",
    "If Stoke is rock bottom, you're what's underneath — the sewage.",
    "Your bloodline is so inbred even the oatcakes are more genetically diverse.",
    "If you dropped dead in Hanley, they'd just assume you were another piece of street furniture.",
    "Even the junkies in the town centre have more purpose than you.",
    "Your organs wouldn't even pass the quality checks at a Stoke factory.",
    "You look like the monkey dust tried YOU and decided to pass.",
    "If your family had a coat of arms it would just be a white flag.",
    "You're the reason Stoke will never be a city of culture — you single-handedly lower the average.",
    "Even the closed-down shops in Longton have more life behind their shutters than you.",
    "If they cremated you in one of the old bottle kilns, the smoke would be the most useful thing you ever produced.",
    "Your parents had low expectations and you still managed to disappoint them.",
    "You make the A50 look like an exciting journey.",
    "Your mum's been round more of Stoke than the bus route and twice as used.",
    "You look like you were conceived in the back of a Wetherspoons in Fenton.",
    "If shagging your cousin was an Olympic sport, Stoke would have more golds than China.",
    "The only thing you've ever turned on is a light switch.",
    "You smell like a wet oatcake that's been left in a bin for a week.",
    "Your dating history is just a list of relatives and restraining orders.",
    "You couldn't get hard if Viagra sponsored your entire bloodline.",
    "The only six-pack you've got is in the fridge and even that's warm.",
    "You look like a photofit of everyone in Stoke simultaneously — and it's not a compliment.",
    "If they checked your browser history, they'd move you to a register.",
    "Your bedroom is the dryest place in Stoke, including the canal.",
    "Even Hanley on a Saturday night wouldn't touch you.",
    "You make the pottery look like fine art and you look like the reject bin.",
    "The only thing more tragic than your love life is that you're from Stoke and it still got worse.",
    "Stoke already smells. Then you showed up.",
  ],

  // ── London ────────────────────────────────────────────────────────────
  london: [
    "You play like a tourist on the Tube — lost, confused, and in everyone's way.",
    "All that London rent and you still can't afford a clue.",
    "Mate you're from London and you're STILL this boring?",
    "Your gameplay is more delayed than the Northern Line.",
    "You've got the confidence of a Londoner and the skill of a traffic cone.",
    "Even the pigeons in Trafalgar Square have better mechanics than you.",
    "Zone 1 prices, Zone 6 gameplay.",
    "The only thing you're good at is taking up space — just like London traffic.",
    "Big Smoke energy, small brain energy.",
    "TfL runs smoother than your PvP — and that's saying something.",
    "You navigate the Wilderness like a cabbie navigates a one-way system — badly.",
    "Your DPS is about as reliable as a Southern Rail service.",
    "Congestion charge applies to your gameplay — it's clogging up the server.",
    "You couldn't hack it in London, so you came here to embarrass yourself instead.",
    "Even the London Eye moves faster than your reaction time.",
  ],

  // ── Manchester ────────────────────────────────────────────────────────
  manchester: [
    "You play like United — spending big and achieving nothing.",
    "It's always raining in Manchester, and your gameplay is just as miserable.",
    "Even the Arndale Centre has more structure than your PvP.",
    "Bro's from Manchester and still can't take on a fight properly.",
    "Your gameplay is as chaotic as a night out on Deansgate.",
    "Oasis broke up with more grace than you break down in PvP.",
    "You've got the Mancunian swagger but absolutely nothing to back it up.",
    "Even Piccadilly Gardens at 3am is less of a mess than your gameplay.",
    "Northern Quarter vibes, absolute zero skills.",
    "Your reaction time is slower than the tram to Bury.",
    "You couldn't find the Wilderness on a map, let alone survive it.",
    "The Beetham Tower sways less than your decision-making.",
    "City's oil money couldn't even buy you a brain cell.",
    "You're the football equivalent of a goalless draw at Old Trafford.",
    "Even the rain in Manchester has better aim than you.",
  ],

  // ── Liverpool ─────────────────────────────────────────────────────────
  liverpool: [
    "You'll never walk alone? Mate, no one wants to walk with you.",
    "Even the Liver Birds are embarrassed for you.",
    "Your gameplay is as dodgy as a knockoff from Paddy's Market.",
    "Scouse charm? More like Scouse harm to this server.",
    "You play like Everton — consistently disappointing.",
    "The only thing Mersey about you is how mercilessly bad you are.",
    "Even the ferry across the Mersey has more direction than your gameplay.",
    "Your takes are about as welcome as a parking ticket on Bold Street.",
    "Anfield's atmosphere couldn't even hype up your gameplay.",
    "You've got the banter of a wet Echo newspaper.",
    "Calm down, calm down — actually no, you should be worried about how bad you are.",
    "The Beatles came from Liverpool. You? You're more of a one-hit blunder.",
    "Albert Dock has more depth than your gameplay.",
    "Your strategy is as lost as a tourist in the Cavern Quarter.",
    "Klopp couldn't even press you into being useful.",
  ],

  // ── Glasgow ───────────────────────────────────────────────────────────
  glasgow: [
    "You play like you're from Glasgow — aggressive but achieving nothing.",
    "Even a deep-fried Mars bar has more substance than your gameplay.",
    "Bro couldn't fight his way out of a Greggs, let alone the Wilderness.",
    "Your patter is absolute mince.",
    "You're about as useful as a chocolate teapot, pal.",
    "Sauchiehall Street on a Saturday night is less messy than your PvP.",
    "You've got the Glasgow kiss of death on every team you join.",
    "Irn-Bru has more fizz than your personality.",
    "The Clyde has more flow than your gameplay.",
    "Celtic and Rangers fans agree on one thing — you're terrible.",
    "Pure dead useless, so ye are.",
    "Your gameplay is as grim as a January morning in Govan.",
    "Even a pigeon on Buchanan Street has more game sense than you.",
    "You bring the same energy as a broken lift in a tower block.",
    "Yer da sells Avon and he's still better than you at PvP.",
  ],

  // ── Newcastle ─────────────────────────────────────────────────────────
  newcastle: [
    "Howay man, even a Greggs sausage roll has more game sense than you.",
    "You play like the Toon — exciting for five minutes then pure disappointment.",
    "You're about as useful as a sunbed in Newcastle — never needed.",
    "Even the Angel of the North has better posture than your gameplay.",
    "Why aye man, that was absolutely shocking.",
    "Your gameplay is colder than the Bigg Market at 2am in January.",
    "Shearer scored 206 goals. You can't even score a single good take.",
    "The only thing getting relegated faster than Newcastle is your reputation.",
    "You couldn't find your way down the Tyne, let alone through the Wilderness.",
    "Brown ale has more kick than your DPS.",
    "St James' Park has seen some disasters, but nothing like your gameplay.",
    "You've got the Geordie enthusiasm and absolutely none of the talent.",
    "Even the Quayside buskers put on a better performance than you.",
    "Your strategy is as lost as a tourist trying to understand Geordie.",
    "Pet, you're an absolute embarrassment.",
    "Your mum still wears a Newcastle shirt to bed. That's the most action either of you has ever seen.",
    "You've got the charm of a half-eaten parmo in a Bigg Market gutter.",
    "Your family tree is a stump, pet.",
    "Even the smackheads under the Tyne Bridge have better life goals.",
    "You were conceived in a Greggs toilet and raised on nothing but Bru and regret.",
    "Your face looks like it was put together from spare parts at the RVI.",
    "The Quayside has seen some right states on a Saturday night, but you're the worst by far.",
    "Your brain has fewer connections than the Metro after midnight.",
    "If Newcastle had a village idiot competition, you'd still somehow come second — to yourself.",
    "Byker Grove produced Ant and Dec. Your estate produced... you. What a waste.",
    "Your personality is as barren as the Town Moor in February.",
    "Even the magpies on the badge look away when you play.",
    "You've got the future of a Sunderland fan — hopeless and going nowhere.",
    "Howay man, even your dog pretends not to know you in public.",
    "You bring the same energy as a closed Greggs — absolute devastation and nothing to offer.",
    "The Great North Run has thousands of finishers. You can't even finish a sentence.",
    "You're the reason Geordies get a bad rep.",
    "Even Sunderland wouldn't claim you, and they're desperate.",
    "Your mum told you that you were special. She was right, but not the way you think.",
    "If your mum could go back in time she'd drink bleach before the conception.",
    "Your dad went out for tabs and honestly, good decision on his part.",
    "You've got the face of a Bigg Market floor at 4am — stomped on and covered in questionable fluids.",
    "If you were any more inbred you'd be a Greggs pasty.",
    "The Tyne would be doing society a favour if you fell in.",
    "Your mum's vagina has seen more traffic than the A1 and produced worse results.",
    "Even the body parts that wash up on the Quayside have more personality.",
    "If your life support got unplugged, the NHS would save money and nobody would cry.",
    "You look like you were conceived during a power cut — your mum clearly couldn't see what she was shagging.",
    "Your bloodline makes the River Tyne look clean.",
    "If they scattered your ashes on St James' Park, it would be the biggest contribution you ever made to Newcastle.",
    "You're the kind of person whose funeral would have more parking than mourners.",
    "Even your obituary would be boring.",
    "Your mum's seen more ceilings than the Sistine Chapel and produced something far less impressive.",
    "You look like you were conceived in the bogs at Digital.",
    "The only thing you've ever pulled is a hamstring running from your responsibilities.",
    "You smell like a mix of brown ale and regret — pure Newcastle.",
    "Your knob is colder than the Tyne in January and about as impressive.",
    "You couldn't pull a sickie convincingly, never mind an actual person.",
    "If they DNA tested the Bigg Market puddles they'd find your relatives.",
    "Your mum's got a body count higher than Newcastle's league position.",
    "You look like a police sketch that nobody bothered to investigate.",
    "The only ride you'll ever get is the Metro, and even that breaks down when it sees you.",
    "Even the working girls on Westgate Road would turn you down.",
    "Your Tinder profile is just a missing persons report that nobody filed.",
    "If pathetic had a postcode it would be yours.",
    "Your love life is deader than the fish in the Tyne.",
    "You're the reason Newcastle has a drinking problem — people need to forget you.",
  ],

  // ── Bristol ───────────────────────────────────────────────────────────
  bristol: [
    "Alright my lover? No actually, your gameplay is far from alright.",
    "You play like you navigate the M32 — always ending up somewhere you didn't intend.",
    "Even Banksy couldn't make your gameplay look good.",
    "You've got Bristol's creativity and absolutely none of its talent.",
    "Your gameplay is as up and down as Park Street.",
    "Even the SS Great Britain has sailed smoother than your PvP.",
    "Clifton Suspension Bridge has more support than your argument.",
    "You're from Bristol and this is the best you can do?",
    "Gert lush? More like gert useless.",
    "Your DPS is weaker than a flat cider from the Coronation Tap.",
    "Cabot Circus has more going round in circles than your strategy.",
    "The balloon fiesta is the only thing in Bristol with more hot air than you.",
    "Even Stokes Croft on a Friday night makes more sense than your gameplay.",
    "You bring the same energy as a cancelled bus on the 76 route.",
    "Brunel built bridges. You just burn them.",
  ],

  // ── Cardiff ───────────────────────────────────────────────────────────
  cardiff: [
    "You play like the Welsh rugby team on an off day — and they have a lot of those.",
    "Even the Millennium Stadium roof can't cover up how bad you are.",
    "Bro's from Cardiff and somehow still can't handle a fight.",
    "Your gameplay is as lost as a tourist in Cardiff Bay.",
    "You've got the passion of a Welsh fan and the skill of a traffic cone.",
    "Even a bowl of cawl has more depth than your strategy.",
    "Iechyd da? More like iechyd nah, you're terrible.",
    "The only dragon energy here is how badly you're getting scorched.",
    "Cardiff City's yo-yo between leagues is more stable than your gameplay.",
    "St David's Centre has shops smarter than you.",
    "Your gameplay is as grey as a Tuesday morning in Splott.",
    "Even the seagulls on Chippy Lane have better reflexes than you.",
    "Brains beer has more intelligence in the name than you have in total.",
    "You're proof that not everything good comes from Wales.",
    "Daffodils have more fight in them than you do.",
  ],

  // ── Sheffield ─────────────────────────────────────────────────────────
  sheffield: [
    "You're from the Steel City but your gameplay is made of tinfoil.",
    "Even Henderson's Relish has more flavour than your personality.",
    "You play like Sheffield Wednesday — mid-table mediocrity.",
    "The full monty was embarrassing, but not as embarrassing as your gameplay.",
    "Your takes are blunter than a Sheffield steel blade left in the rain.",
    "Even the hills in Sheffield have more ups than your gameplay.",
    "You couldn't navigate Meadowhall, let alone the Wilderness.",
    "The Crucible hosts world-class snooker. Your gameplay? Not world-class anything.",
    "You've got all the charm of a wet afternoon in Attercliffe.",
    "United or Wednesday, both sets of fans would disown your gameplay.",
    "Your DPS is flatter than the Don Valley.",
    "Arctic Monkeys put Sheffield on the map. You're trying to take it off.",
    "Even the tram to Halfway is less of a journey than watching you play.",
    "Your strategy has more holes than a Sheffield cheese grater.",
    "Ee by gum, that were absolutely dreadful.",
  ],

  // ── Edinburgh ─────────────────────────────────────────────────────────
  edinburgh: [
    "You've got Edinburgh's smugness and absolutely none of the class.",
    "Even the Edinburgh Festival wouldn't book your act — it's that bad.",
    "Your gameplay is as steep and painful as walking up the Royal Mile.",
    "Arthur's Seat has better positioning than you in PvP.",
    "You play like a tourist trap — all show, no substance.",
    "The castle's been standing for centuries. Your gameplay crumbles in seconds.",
    "Even a piper on Princes Street puts on a better performance.",
    "Your strategy is as lost as a Fringe show with no audience.",
    "Haggis has more guts than your PvP approach.",
    "You bring the same energy as a cancelled Edinburgh tram.",
    "Leith Walk has seen some sights, but your gameplay is the worst.",
    "You're proof that living in a beautiful city doesn't make you any less useless.",
    "The Scott Monument has more point to it than your gameplay.",
    "Even Greyfriars Bobby had more fight in him — and he's been dead for 150 years.",
    "One o'clock gun fires daily and it's still less predictable than your failures.",
  ],

  // ── Belfast ───────────────────────────────────────────────────────────
  belfast: [
    "You play like you drive in Belfast — dangerously and with no sense of direction.",
    "Even the Titanic had a better run than your gameplay, and it sank.",
    "Your takes are drier than a Sunday in Belfast used to be.",
    "Bro's from Belfast and still can't handle the heat.",
    "The peace walls have more flexibility than your strategy.",
    "Your gameplay is as confusing as Belfast's one-way system.",
    "Even a bag of Tayto crisps has more crunch than your DPS.",
    "Victoria Square has more polish than your mechanics.",
    "You've got the Belfast attitude and none of the Belfast toughness.",
    "Cathedral Quarter has pubs smarter than you.",
    "Your gameplay sank faster than the Titanic — and it was built better.",
    "Even the Harland & Wolff cranes carry more weight than your opinions.",
    "You're about as welcome as rain at Balmoral Show.",
    "The Lagan flows with more purpose than your gameplay.",
    "Catch yourself on, that was absolutely brutal.",
  ],

  // ── Nottingham ────────────────────────────────────────────────────────
  nottingham: [
    "Robin Hood stole from the rich. You just steal everyone's time.",
    "Even Sherwood Forest has fewer lost souls than your gameplay.",
    "You play like Notts County — technically existing, barely competing.",
    "Your gameplay is as hollow as the Caves of Nottingham.",
    "Bro's from Nottingham and still can't hit a target.",
    "Even a Goose Fair ride is less nauseating than watching you play.",
    "The left and right legs of Nottingham Forest both play better than you.",
    "You couldn't rob a spec if Robin Hood himself coached you.",
    "Your takes are as tired as the walk up to the castle.",
    "Even Old Market Square has more character than you.",
    "Wollaton Hall has a Batman connection. You? You're more like a background NPC.",
    "You bring the energy of a deflated bouncy castle at Goose Fair.",
    "The tram to Hucknall has more drive than you.",
    "Even Ye Olde Trip to Jerusalem has fresher takes — and it's from 1189.",
    "Maid Marian would swipe left on your gameplay.",
  ],

  // ── Southampton ───────────────────────────────────────────────────────
  southampton: [
    "You play like Southampton — a feeder club for better players.",
    "The Itchen flows with more purpose than your gameplay.",
    "Bro's from Southampton and still thinks he's a big fish.",
    "Your gameplay is as flat as the Solent on a calm day.",
    "Even the cruise ships that leave Southampton want nothing to do with you.",
    "You're the human equivalent of Southampton getting relegated — expected and sad.",
    "West Quay has more direction than your strategy.",
    "Even the Mayflower had a better game plan — and half of them died.",
    "Your takes are as empty as St Mary's on a Wednesday night.",
    "You play like a player who peaked at Southampton — it's all downhill.",
    "Even the New Forest ponies have better game sense.",
    "Ocean Village has more depth than your PvP.",
    "You bring the same energy as roadworks on the M27.",
    "Your gameplay makes Southampton's transfer policy look competent.",
    "Even Bargate has stood the test of time better than your reputation.",
  ],

  // ── Brighton ──────────────────────────────────────────────────────────
  brighton: [
    "You play like Brighton — plucky but ultimately going nowhere.",
    "Even the seagulls stealing chips on the pier have better strategy.",
    "Your gameplay is as unpredictable as Brighton weather — consistently bad.",
    "You've got the Brighton vibes and none of the substance.",
    "The Lanes are confusing, but not as confusing as your decision-making.",
    "Your takes are as stale as day-old fish and chips on the beach.",
    "Even the burnt-out West Pier has more structural integrity than your gameplay.",
    "The i360 goes up and down — your gameplay just goes down.",
    "You bring festival energy with food poisoning results.",
    "North Laine has more culture in one street than you have in total.",
    "Your DPS is weaker than a half-pint in Kemptown.",
    "Even the nudists on the beach are less exposed than your defence.",
    "The Palace Pier has more game than you — and it's mostly 2p machines.",
    "Your strategy washed up faster than the pebbles on Brighton Beach.",
    "De Zerbi couldn't even coach you into being mid.",
  ],

  // ── Plymouth ──────────────────────────────────────────────────────────
  plymouth: [
    "Drake sailed around the world from Plymouth. You can't even navigate the GE.",
    "Even the Hoe has more action than your gameplay.",
    "Your gameplay is as grey as Plymouth on a November morning.",
    "Bro's from Plymouth and somehow still lost at sea.",
    "The Barbican has more character in one street than you have in total.",
    "Even a tin of pilchards from Sutton Harbour has more game sense.",
    "Your takes are drier than the Devonport dockyard.",
    "Argyle have had some low points, but your gameplay is a new low.",
    "You couldn't hit the Breakwater if you were standing on it.",
    "Even the seagulls at the Fish Quay outplay you.",
    "The Tamar Bridge connects two counties. You can't even connect two brain cells.",
    "Your gameplay is as forgettable as Plymouth's nightlife.",
    "Even the Mayflower Steps have seen better departures than your log-offs.",
    "Royal William Yard got renovated. Your gameplay needs demolishing.",
    "Janners have more fight in them — what happened to you?",
  ],

  // ── York ──────────────────────────────────────────────────────────────
  york: [
    "The Romans built walls to keep people out. We need one to keep your takes out.",
    "You play like a Viking — all aggression, no plan.",
    "Even the Shambles has more order than your gameplay.",
    "Your strategy is as old and crumbling as the city walls.",
    "The Minster took 250 years to build. You couldn't build a strategy in 250 minutes.",
    "Even a ghost tour in York is less scary than your gameplay.",
    "You've got the historical charm of a car park.",
    "Betty's serves fine tea. You serve nothing but disappointment.",
    "Clifford's Tower has been through fires and sieges. Your gameplay wouldn't survive a breeze.",
    "The railway museum has trains going nowhere — just like your career.",
    "Your takes are more medieval than York itself.",
    "Even the buskers in King's Square put on a better show.",
    "You're proof that history doesn't always repeat — sometimes it gets worse.",
    "Jorvik Viking Centre smells better than your gameplay.",
    "Guy Fawkes came from York. Your gameplay is the real treason.",
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
//  PERSISTENCE  —  data/roast_users.json
// ═════════════════════════════════════════════════════════════════════════════

// { "userId": "poolKey", ... }
let userLangMap = {};

function loadUsers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(USERS_FILE)) {
      userLangMap = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      console.log(`[ROAST] Loaded ${Object.keys(userLangMap).length} user mappings.`);
    }
  } catch (err) {
    console.error('[ROAST] Failed to load user mappings:', err);
  }
}

function saveUsers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(userLangMap, null, 2), 'utf8');
  } catch (err) {
    console.error('[ROAST] Failed to save user mappings:', err);
  }
}

// Load on import
loadUsers();

// ═════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** All valid pool keys (lowercase) */
const validPools = Object.keys(roastsByLang);

/** Friendly grouped list for the !roastlocations embed */
function poolList() {
  const langs = [];
  const regions = [];
  for (const key of validPools) {
    // Rough split: keys > 2 chars that aren't standard lang codes → region
    const isRegion = [
      'cambridge','birmingham','leeds','stoke','london','manchester',
      'liverpool','glasgow','newcastle','bristol','cardiff','sheffield',
      'edinburgh','belfast','nottingham','southampton','brighton',
      'plymouth','york','ireland','ireland-urdu','america','canada',
    ].includes(key);
    if (isRegion) regions.push(key);
    else langs.push(key);
  }
  return { langs, regions };
}

function pickRoast(userId) {
  const lang = userLangMap[userId] || 'en';
  const pool = roastsByLang[lang] || roastsByLang.en;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Extract a raw user ID from either a raw snowflake or a <@!id> / <@id> mention.
 */
function parseUserId(str) {
  if (!str) return null;
  const mention = str.match(/^<@!?(\d+)>$/);
  if (mention) return mention[1];
  if (/^\d{17,20}$/.test(str)) return str;
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER  (called from bot.js on every messageCreate)
// ═════════════════════════════════════════════════════════════════════════════

export async function handleRoast(message) {
  if (message.author.bot) return false;

  // ── Admin commands (work in ANY channel) ────────────────────────────────
  const content = message.content.trim();

  // !addinsults <UID|@mention> <location>
  if (content.toLowerCase().startsWith('!addinsults')) {
    return await cmdAddInsults(message, content);
  }

  // !removeinsults <UID|@mention>
  if (content.toLowerCase().startsWith('!removeinsults')) {
    return await cmdRemoveInsults(message, content);
  }

  // !listinsults
  if (content.toLowerCase() === '!listinsults') {
    return await cmdListInsults(message);
  }

  // !roastlocations
  if (content.toLowerCase() === '!roastlocations') {
    return await cmdRoastLocations(message);
  }

  // ── Random roast (only in the configured channel) ──────────────────────
  if (message.channel.id !== ROAST_CHANNEL_ID) return false;

  // 10% chance
  if (Math.random() > ROAST_CHANCE) return false;

  const roast = pickRoast(message.author.id);

  try {
    await message.reply(roast);
    const pool = userLangMap[message.author.id] || 'en';
    console.log(`[ROAST] Fired at ${message.author.tag} (${pool}) in #${message.channel.name}`);
  } catch (err) {
    console.error('[ROAST] Failed to send:', err);
  }

  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMMANDS
// ═════════════════════════════════════════════════════════════════════════════

async function cmdAddInsults(message, content) {
  const parts = content.split(/\s+/);
  // parts[0] = !addinsults, parts[1] = uid/mention, parts[2] = location
  const uid      = parseUserId(parts[1]);
  const location = parts[2]?.toLowerCase();

  if (!uid || !location) {
    await message.reply('**Usage:** `!addinsults <UID or @mention> <location>`\nUse `!roastlocations` to see all available pools.');
    return true;
  }

  if (!roastsByLang[location]) {
    const { langs, regions } = poolList();
    await message.reply(
      `**"${location}"** isn't a valid pool.\n` +
      `**Languages:** ${langs.map(l => `\`${l}\``).join(', ')}\n` +
      `**UK Regions:** ${regions.map(r => `\`${r}\``).join(', ')}`
    );
    return true;
  }

  userLangMap[uid] = location;
  saveUsers();

  const count = roastsByLang[location].length;
  await message.reply(`Got it — <@${uid}> is now assigned to **${location}** (${count} roasts). They won't know what hit 'em.`);
  console.log(`[ROAST] ${message.author.tag} assigned ${uid} → ${location}`);
  return true;
}

async function cmdRemoveInsults(message, content) {
  const parts = content.split(/\s+/);
  const uid   = parseUserId(parts[1]);

  if (!uid) {
    await message.reply('**Usage:** `!removeinsults <UID or @mention>`');
    return true;
  }

  if (!userLangMap[uid]) {
    await message.reply(`<@${uid}> doesn't have a custom roast pool assigned. They'll get the default English roasts.`);
    return true;
  }

  const old = userLangMap[uid];
  delete userLangMap[uid];
  saveUsers();

  await message.reply(`Removed <@${uid}> from **${old}**. They'll get default English roasts now.`);
  console.log(`[ROAST] ${message.author.tag} removed ${uid} (was ${old})`);
  return true;
}

async function cmdListInsults(message) {
  const entries = Object.entries(userLangMap);
  if (entries.length === 0) {
    await message.reply('No custom roast assignments yet. Use `!addinsults <UID> <location>` to add one.');
    return true;
  }

  const lines = entries.map(([uid, pool]) => `<@${uid}> → **${pool}** (${roastsByLang[pool]?.length ?? '?'} roasts)`);
  // Discord message limit is 2000 chars, chunk if needed
  const chunks = [];
  let current = '**Roast Assignments:**\n';
  for (const line of lines) {
    if (current.length + line.length + 1 > 1900) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await message.reply(chunk);
  }
  return true;
}

async function cmdRoastLocations(message) {
  const { langs, regions } = poolList();
  const langStr   = langs.map(l => `\`${l}\` (${roastsByLang[l].length})`).join(', ');
  const regionStr = regions.map(r => `\`${r}\` (${roastsByLang[r].length})`).join(', ');

  await message.reply(
    `**Available Roast Pools:**\n\n` +
    `**Languages:**\n${langStr}\n\n` +
    `**UK Regions:**\n${regionStr}\n\n` +
    `Use \`!addinsults <UID or @mention> <location>\` to assign one.`
  );
  return true;
}
