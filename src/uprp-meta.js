/**
 * Metadane API UPRP e-Wyszukiwarka — na podstawie docs/e-Wyszukiwarka.pdf
 * oraz specyfikacji OpenAPI (https://api.uprp.gov.pl/ewyszukiwarka/api/doc/external/config).
 * Słowniki (atrybuty, kolekcje, typy PWP) są pobierane na żywo z API i cache'owane;
 * tutaj trzymamy tylko stałe elementy formularzy.
 */

export const UPRP = {
  id: 'uprp',
  label: 'UPRP e-Wyszukiwarka',
  base: 'https://api.uprp.gov.pl/ewyszukiwarka/api/external',
  docUrl: 'https://api.uprp.gov.pl/doc/ewyszukiwarka',

  /** Operatory łączenia warunków wyszukiwania zaawansowanego. */
  logicalOperators: [
    { value: 'and', label: 'ORAZ' },
    { value: 'or', label: 'LUB' },
    { value: 'not', label: 'NIE' },
  ],

  /** Operatory dopasowania tekstu. */
  stringOperators: [
    { value: 'contains', label: 'zawiera' },
    { value: 'is', label: 'jest' },
    { value: 'begins', label: 'zaczyna się' },
    { value: 'ends', label: 'kończy się' },
  ],

  idLabel: 'Numer zgłoszenia',
  idExamples: ['Z.381951', 'P.380618', 'W.127232', 'Wp.21001'],

  /** Parametry usługi search-bibliographics-results. */
  publishers: ['BUP', 'WUP'],
  pwpTypeNames: [
    'Znaki Towarowe', 'Wynalazki', 'Patenty Europejskie', 'Dodatkowe Prawa Ochronne',
    'Wzory Użytkowe', 'Wzory Przemysłowe', 'Topografia Układów Scalonych',
  ],

  /** Typy PWP — awaryjnie, gdy słownik z API jest niedostępny. */
  pwpTypesFallback: [
    { id: 1, type: 'Znaki Towarowe' },
    { id: 2, type: 'Wynalazki' },
    { id: 3, type: 'Patenty Europejskie' },
    { id: 4, type: 'Dodatkowe Prawa Ochronne' },
    { id: 5, type: 'Wzory Użytkowe' },
    { id: 6, type: 'Wzory Przemysłowe' },
    { id: 7, type: 'Topografia Układów Scalonych' },
  ],

  searchExamples: [
    {
      label: 'Znaki towarowe zawierające „neuron"',
      criteria: [{ attributeId: 170, stringOperator: 'contains', text: 'neuron' }],
      pwpTypes: [1],
    },
    {
      label: 'Wynalazki zgłoszone w 2024 r.',
      criteria: [{ attributeId: 156, from: '2024-01-01', to: '2024-12-31' }],
      pwpTypes: [2],
    },
    {
      label: 'Zgłaszający z Krakowa, status: Udzielenie prawa',
      criteria: [
        { attributeId: 146, stringOperator: 'is', text: 'Kraków' },
        { attributeId: 195, logicalOperator: 'and', stringOperator: 'contains', text: 'udzielenie' },
      ],
    },
  ],
};
