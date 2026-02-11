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
const ROAST_CHANCE     = 0.10; // 10%
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
