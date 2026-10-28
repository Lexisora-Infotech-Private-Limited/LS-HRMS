/**
 * Extra font families every designer can use (payslip, ID card, visiting card). The same files are bundled on the server
 * (`apps/api/assets/fonts`, drawn into PDFs and card images) and loaded in the browser, so what you design is what prints.
 * `file` is the file-name prefix on the server; `avg` is the average letter width (in em) used to wrap and fit text.
 */
export const CUSTOM_FONTS = {
  opensans: { file: 'open-sans', label: 'Open Sans', css: "'Open Sans', sans-serif", avg: 0.55, italic: true },
  roboto: { file: 'roboto', label: 'Roboto', css: 'Roboto, sans-serif', avg: 0.5, italic: true },
  lato: { file: 'lato', label: 'Lato', css: 'Lato, sans-serif', avg: 0.5, italic: true },
  montserrat: { file: 'montserrat', label: 'Montserrat', css: 'Montserrat, sans-serif', avg: 0.6, italic: true },
  poppins: { file: 'poppins', label: 'Poppins', css: 'Poppins, sans-serif', avg: 0.58, italic: true },
  inter: { file: 'inter', label: 'Inter', css: 'Inter, sans-serif', avg: 0.54, italic: true },
  nunito: { file: 'nunito', label: 'Nunito', css: 'Nunito, sans-serif', avg: 0.52, italic: true },
  raleway: { file: 'raleway', label: 'Raleway', css: 'Raleway, sans-serif', avg: 0.54, italic: true },
  playfair: { file: 'playfair-display', label: 'Playfair Display', css: "'Playfair Display', serif", avg: 0.54, italic: true },
  merriweather: { file: 'merriweather', label: 'Merriweather', css: 'Merriweather, serif', avg: 0.58, italic: true },
  lora: { file: 'lora', label: 'Lora', css: 'Lora, serif', avg: 0.5, italic: true },
  oswald: { file: 'oswald', label: 'Oswald (condensed)', css: 'Oswald, sans-serif', avg: 0.42, italic: false },
  dancing: { file: 'dancing-script', label: 'Dancing Script (handwriting)', css: "'Dancing Script', cursive", avg: 0.42, italic: false },
} as const;
export type CustomFontKey = keyof typeof CUSTOM_FONTS;
