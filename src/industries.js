/**
 * Branże zamiast klas nicejskich (plan, sekcja 2): kafelki w formularzu badania i nazwy klas
 * prostym językiem w wynikach. Mapowanie robocze, do sprawdzenia z rzecznikiem.
 * `keywords` — rdzenie słów, po których pole „Czym się zajmujesz?” podpowiada kafelki.
 * Klasa 35 (reklama i handel) tylko przy handlu, marketingu i doradztwie: przy towarach zbiega się
 * z większością zarejestrowanych znaków i zawyża ryzyko. Kto sprzedaje, zaznacza też „Sklep internetowy”.
 */

export const INDUSTRIES = [
  { id: 'odziez', label: 'Odzież i obuwie', classes: [25], keywords: ['odziez', 'ubran', 'koszul', 'buty', 'obuw', 'moda', 'sukien'] },
  { id: 'torby', label: 'Torby i wyroby skórzane', classes: [18], keywords: ['torb', 'plecak', 'portfel', 'skor'] },
  { id: 'bizuteria', label: 'Biżuteria i zegarki', classes: [14], keywords: ['bizuter', 'zegar', 'pierscion', 'kolczyk'] },
  { id: 'kosmetyki', label: 'Kosmetyki i perfumy', classes: [3], keywords: ['kosmety', 'perfum', 'krem', 'mydl', 'pielegnac'] },
  { id: 'zdrowie', label: 'Leki i suplementy', classes: [5], keywords: ['lek', 'suplement', 'witamin', 'aptek'] },
  { id: 'medycyna', label: 'Gabinet, zdrowie, uroda', classes: [44], keywords: ['gabinet', 'lekarz', 'stomatolog', 'fryzjer', 'salon', 'masaz', 'fizjoterap', 'psycholog'] },
  { id: 'jedzenie', label: 'Jedzenie i słodycze', classes: [29, 30], keywords: ['jedzen', 'zywno', 'piekar', 'cukier', 'slodycz', 'ciast', 'kaw', 'herbat', 'miod', 'przetwor'] },
  { id: 'napoje', label: 'Piwo i napoje', classes: [32], keywords: ['piw', 'browar', 'napoj', 'sok', 'lemoniad'] },
  { id: 'alkohol', label: 'Wino i alkohole', classes: [33], keywords: ['win', 'wodk', 'alkohol', 'nalewk', 'gin', 'whisk'] },
  { id: 'gastronomia', label: 'Restauracja, kawiarnia, catering', classes: [43], keywords: ['restaurac', 'kawiarn', 'bistro', 'catering', 'bar', 'pizz', 'food truck'] },
  { id: 'noclegi', label: 'Hotel i noclegi', classes: [43], keywords: ['hotel', 'nocleg', 'pensjonat', 'apartament', 'agroturyst'] },
  { id: 'aplikacje', label: 'Aplikacje i oprogramowanie', classes: [9, 42], keywords: ['aplikac', 'oprogramowan', 'software', 'saas', 'program'] },
  { id: 'it', label: 'Usługi IT i strony internetowe', classes: [42], keywords: ['stron', 'www', 'informaty', 'hosting', 'it '] },
  { id: 'elektronika', label: 'Elektronika i sprzęt', classes: [9], keywords: ['elektroni', 'komputer', 'telefon', 'sprzet'] },
  { id: 'marketing', label: 'Marketing i reklama', classes: [35], keywords: ['marketing', 'reklam', 'agencj', 'social media', 'pr '] },
  { id: 'sklep', label: 'Sklep internetowy', classes: [35], keywords: ['sklep', 'e-commerce', 'ecommerce', 'handel', 'sprzedaz'] },
  { id: 'edukacja', label: 'Szkolenia i edukacja', classes: [41], keywords: ['szkolen', 'kurs', 'edukac', 'szkol', 'warsztat', 'nauk', 'korepetyc'] },
  { id: 'rozrywka', label: 'Wydarzenia, muzyka, rozrywka', classes: [41], keywords: ['wydarzen', 'koncert', 'muzy', 'zespol', 'festiwal', 'event', 'slub', 'ceremoni'] },
  { id: 'sport', label: 'Sport i fitness', classes: [28, 41], keywords: ['sport', 'fitness', 'silowni', 'trening', 'joga', 'rower'] },
  { id: 'zabawki', label: 'Zabawki i gry', classes: [28], keywords: ['zabawk', 'gry', 'gra ', 'planszow', 'puzzle'] },
  { id: 'meble', label: 'Meble i wnętrza', classes: [20], keywords: ['mebl', 'wnetrz', 'stol', 'krzesl', 'sof'] },
  { id: 'dom', label: 'Artykuły domowe i kuchenne', classes: [21], keywords: ['kuchen', 'naczyn', 'kubk', 'ceramik', 'dom'] },
  { id: 'tekstylia', label: 'Tekstylia domowe', classes: [24], keywords: ['posciel', 'reczni', 'tkanin', 'zaslon'] },
  { id: 'swiece', label: 'Świece i oświetlenie', classes: [4, 11], keywords: ['swiec', 'lamp', 'oswietlen', 'zapach'] },
  { id: 'budownictwo', label: 'Budownictwo i remonty', classes: [19, 37], keywords: ['budow', 'remont', 'wykonczen', 'dach', 'instalac'] },
  { id: 'motoryzacja', label: 'Samochody i warsztat', classes: [12, 37], keywords: ['samochod', 'auto', 'warsztat', 'mechani', 'motocykl'] },
  { id: 'transport', label: 'Transport i logistyka', classes: [39], keywords: ['transport', 'logistyk', 'przeprowadz', 'kurier', 'spedyc'] },
  { id: 'turystyka', label: 'Podróże i turystyka', classes: [39, 43], keywords: ['podroz', 'turyst', 'wycieczk', 'biuro podrozy'] },
  { id: 'finanse', label: 'Finanse i ubezpieczenia', classes: [36], keywords: ['finans', 'ubezpiecz', 'kredyt', 'inwestyc', 'ksiegow'] },
  { id: 'nieruchomosci', label: 'Nieruchomości', classes: [36], keywords: ['nieruchomo', 'mieszkan', 'wynajem', 'deweloper'] },
  { id: 'prawo', label: 'Usługi prawne i doradztwo', classes: [45, 35], keywords: ['prawn', 'kancelari', 'adwokat', 'radca', 'doradztw', 'konsulting'] },
  { id: 'wydawnictwo', label: 'Książki, druk, papeteria', classes: [16, 41], keywords: ['ksiaz', 'wydawn', 'druk', 'papeteri', 'kalendarz', 'introligator'] },
  { id: 'zwierzeta', label: 'Zwierzęta', classes: [31, 44], keywords: ['zwierz', 'pies', 'psy', 'kot', 'weteryn', 'karm'] },
  { id: 'ogrod', label: 'Rośliny i ogród', classes: [31, 44], keywords: ['rosli', 'ogrod', 'kwiat', 'florysty'] },
  { id: 'foto', label: 'Foto i wideo', classes: [41, 9], keywords: ['fotograf', 'zdjec', 'wideo', 'film'] },
];

/** Krótkie nazwy klas nicejskich (wersja 12) do pokazywania zamiast numerów. */
export const CLASS_NAMES = {
  1: 'chemikalia', 2: 'farby i lakiery', 3: 'kosmetyki i środki czystości', 4: 'świece i paliwa',
  5: 'leki i suplementy', 6: 'wyroby z metalu', 7: 'maszyny', 8: 'narzędzia ręczne',
  9: 'elektronika i oprogramowanie', 10: 'sprzęt medyczny', 11: 'oświetlenie, ogrzewanie, AGD', 12: 'pojazdy',
  13: 'broń i fajerwerki', 14: 'biżuteria i zegarki', 15: 'instrumenty muzyczne', 16: 'papier i druk',
  17: 'guma i tworzywa', 18: 'torby i wyroby skórzane', 19: 'materiały budowlane', 20: 'meble',
  21: 'artykuły kuchenne i domowe', 22: 'liny i plandeki', 23: 'przędza i nici', 24: 'tkaniny i tekstylia domowe',
  25: 'odzież i obuwie', 26: 'pasmanteria', 27: 'dywany i tapety', 28: 'zabawki i sprzęt sportowy',
  29: 'mięso, nabiał, przetwory', 30: 'kawa, pieczywo, słodycze', 31: 'rolnictwo, rośliny, karma', 32: 'piwo i napoje',
  33: 'wino i alkohole', 34: 'wyroby tytoniowe', 35: 'reklama i handel', 36: 'finanse i nieruchomości',
  37: 'budowa, naprawy, sprzątanie', 38: 'telekomunikacja', 39: 'transport i podróże', 40: 'obróbka materiałów',
  41: 'edukacja i rozrywka', 42: 'usługi IT i naukowe', 43: 'gastronomia i noclegi', 44: 'medycyna i uroda',
  45: 'usługi prawne i ochrona',
};
