/* Słowniki heurystyk (PL/EN/DE/FR/ES/IT/NL/CS) i reguły znanych CMP.
 * Wszystkie wzorce działają na tekście znormalizowanym: małe litery, bez polskich znaków (ł→l), pojedyncze spacje. */
(function (g) {
  'use strict';

  // ---------- przyciski ----------
  const BTN_REJECT = [
    /\bodrzuc/, /\bodrzucam/, /\bodmawiam/, /\bodmow/, /nie zgadzam/, /nie akceptuj/, /nie wyrazam zgody/, /nie zezwalam/,
    /(tylko|wylacznie|jedynie) (niezbedne|wymagane|konieczne|podstawowe|techniczne)/,
    /(akceptuj|zaakceptuj|zezwol na|zgoda na|uzywaj) (tylko |wylacznie |jedynie )?(niezbedne|wymagane|konieczne|podstawowe)/,
    /kontynuuj bez/, /przejdz dalej bez/, /bez (akceptacji|zgody)/,
    /\breject/, /\bdeclin/, /\bdeny\b/, /\brefuse/, /\bdisagree/, /do not (accept|agree|consent)/, /don'?t (accept|agree|consent)/,
    /(only|just|accept|use|allow) (strictly )?(necessary|essential|required)/, /(necessary|essential|required)( cookies)? only/,
    /continue without/, /\bopt.?out\b/, /\bno,? thanks\b/,
    /ablehn/, /nicht (zustimmen|akzeptieren|einverstanden)/, /nur (notwendig|essenziell|erforderlich|technisch)/, /ohne (zustimmung|einwilligung)/, /verweiger/,
    /\brefuser/, /\btout refuser/, /continuer sans/, /je refuse/, /seulement (les )?(necessaires|essentiels)/,
    /\brechaz/, /\bdenegar/, /solo (las )?(necesarias|esenciales)/, /continuar sin/,
    /\brifiut/, /\bnega\b/, /solo (i )?(necessari|essenziali|tecnici)/, /continua senza/,
    /\bweiger/, /\bafwijzen/, /alleen (noodzakelijk|essentieel|functioneel)/,
    /\bodmitn/, /pouze nezbytn/, /\bnesouhlas/
  ];

  const BTN_SAVE = [
    /\bzapisz/, /\bzatwierdz/, /\bpotwierdz/, /(akceptuj|zaakceptuj|zezwol na|zapisz) (wybran|zaznaczon|moj wybor|wybor)/,
    /\bsave\b/, /\bconfirm/, /(accept|allow) (selected|selection|my selection|current|chosen)/, /\bapply\b/, /\bsubmit\b/,
    /speicher/, /auswahl (bestatigen|erlauben|akzeptieren|zulassen|speichern)/, /\bbestatig/,
    /enregistr/, /\bvalider/, /\bconfirmer/,
    /\bguardar/, /\bconfirmar/,
    /\bsalva/, /\bconferm/,
    /\bopslaan/, /\bbevestig/,
    /\bulozit/, /\bpotvrdit/
  ];

  const WORD_ALL = [/wszystk/, /\ball\b/, /\balle\b/, /\btous\b/, /\btout\b/, /\btodas?\b/, /\btutt[ie]\b/, /\bvse\b/];

  const BTN_PAY = [
    /subskryb/, /subskrypc/, /abonament/, /\bwykup/, /zaplac/, /\boplat/, /bez reklam/, /\bpremium\b/,
    /subscri/, /\bpay\b/, /\bpayment/, /ad.?free/, /without ads/, /reject and (pay|subscribe)/,
    /\babo\b/, /abonnier/, /\bpur\b/, /werbefrei/, /ohne werbung/, /contentpass/, /\bzahlen/, /bezahl/,
    /s'abonner/, /\babonn/, /\bpayer\b/, /sans publicit/,
    /suscrib/, /\bpagar\b/, /sin publicidad/,
    /abbona/, /senza pubblicit/, /\bpagare\b/,
    /\bbetal/, /zonder advertenties/, /\babonneer/,
    /predplat/
  ];

  const BTN_ACCEPT = [
    /\bakceptuj/, /\bzaakceptuj/, /\bakceptuje/, /\bzgadzam/, /przejdz do (serwisu|strony)/, /przechodze do (serwisu|strony)/,
    /\brozumiem/, /\bprzyjmuj/, /wyrazam zgode/, /\bdaj zgode/, /\bzezwol/, /\bjasne\b/,
    /^ok\b/, /^okay\b/, /\baccept/, /\bagree/, /\ballow/, /^consent\b/, /^i consent/,/got it/, /\bi understand/, /^continue\b/, /^yes\b/,
    /akzeptier/, /zustimm/, /einverstanden/, /erlauben/, /zulassen/, /^weiter\b/,
    /\baccepter/, /j'accepte/, /d'accord/, /autoriser/, /^continuer\b/,
    /\bacept/, /de acuerdo/, /\bpermitir/,
    /\baccett/, /\bconsenti/, /\bacconsent/,
    /\bakkoord/, /accepteer/, /toestaan/,
    /\bsouhlas/, /\bprijmout/, /\bpovolit/
  ];

  const BTN_SETTINGS = [
    /ustawien/, /\bdostosuj/, /zarzadz/, /preferencj/, /wiecej opcji/, /\bopcje\b/, /szczegol/, /personalizuj/, /\bkonfigur/, /dowiedz sie wiecej/, /\bwiecej\b/,
    /settings/, /\bcustomi[sz]/, /\bmanage/, /preferences/, /\boptions\b/, /\bdetails\b/, /configur/, /learn more/, /show purposes/, /\bmore\b/,
    /einstellung/, /\banpass/, /verwalt/, /individuell/, /mehr optionen/, /\bdetails\b/,
    /parametr/, /personnalis/, /\bgerer/, /en savoir plus/,
    /configurar/, /personalizar/, /\bgestion/, /mas opciones/,
    /gestisci/, /impostazion/, /personalizz/, /piu opzioni/,
    /instelling/, /\baanpass/, /\bbeheer/,
    /nastaven/, /\bupravit/, /podrobnost/
  ];

  const BTN_CLOSE = /^(x|×|✕|✖|zamknij|close|schliessen|fermer|cerrar|chiudi|sluiten|zavrit)$/;

  // „Sprzeciw wobec wszystkich” w sekcjach uzasadnionego interesu
  const BTN_OBJECT_ALL = [
    /sprzeciw/, /\bobject\b/, /object (to )?all/, /widerspr/, /\bopposer/, /\bs'opposer/, /\boponer/, /oposicion/, /\bopporsi/, /opposizione/, /bezwaar/, /\bnamitk/
  ];

  // ---------- tekst banera ----------
  const TXT_STRONG = [
    /cookie/, /ciasteczk/, /ciastecz/, /\brodo\b/, /\bgdpr\b/, /\brgpd\b/, /\bdsgvo\b/, /\btcf\b/, /\btracker/, /traceur/, /sledzac/, /tracking/
  ];
  const TXT_WEAK = [
    /zgod/, /prywatnos/, /dane osobow/, /twoich danych/, /przetwarzan/, /partner/, /reklam/,
    /consent/, /privacy/, /personal data/, /your data/, /partners/, /vendors/, /advertis/,
    /einwillig/, /datenschutz/, /zustimmung/, /consentement/, /donnees/, /consentimiento/, /privacidad/,
    /consenso/, /toestemming/, /souhlas/, /soukromi/, /legitimate interest/, /uzasadnion/
  ];
  const TXT_PAY = [
    /subskrypc/, /subskryb/, /wykup (dostep|abonament|subskrypc)/, /\bzaplac/, /bez reklam/, /platn(y|a|e) (dostep|wersj|abonament)/,
    /subscri(be|ption)/, /\bpay\b/, /ad.?free/, /without ads/, /pay or (ok|accept)/, /reject and pay/,
    /\bpur\b/, /\bpur.?abo/, /werbefrei/, /ohne werbung/, /contentpass/, /abo abschliess/, /bezahl/,
    /sans publicit/, /\bs'abonner/, /sin publicidad/, /suscripcion/, /senza pubblicit/, /abbonament/, /zonder advertenties/, /predplatn/
  ];

  // ---------- klasyfikacja kategorii (etykiety przełączników) ----------
  const CAT = {
    legitimateInterest: [/uzasadnion/, /legitimate interest/, /\blegit\.? interest/, /berechtigt/, /interet legitime/, /interes legitimo/, /legittimo interesse/, /interesse legittimo/, /gerechtvaardigd belang/, /opravneny zajem/],
    necessary: [/niezbedn/, /\bkoniecz/, /\bwymagan/, /scisle/, /techniczn/, /podstawow/, /\bnecessary/, /\bessential/, /\bstrictly/, /\brequired/, /\btechnical/, /notwendig/, /erforderlich/, /essenziell/, /technisch/, /necessaire/, /essentiel/, /necesari/, /esencial/, /tecnic/, /necessari/, /essenzial/, /noodzakelijk/, /essentieel/, /nezbytn/, /\bnutn/],
    marketing: [/marketing/, /reklam/, /advertis/, /\bads?\b/, /targeting/, /targetow/, /ukierunkow/, /werbung/, /\bwerbe/, /publicit/, /publicidad/, /pubblicit/, /advertentie/, /reclame/, /retarget/, /remarketing/, /\bad (selection|measurement|profile)/],
    analytics: [/analit/, /analyt/, /statyst/, /statist/, /wydajnos/, /\bpomiar/, /mierzen/, /\bperformance/, /\bmeasure/, /audience/, /leistung/, /\bmessung/, /\bmesure/, /rendimiento/, /medicion/, /prestazion/, /misurazion/, /prestaties/, /\bmeten\b/, /\bvykon/, /\bmereni/],
    social: [/spolecznosc/, /social/, /soziale/, /sociaux/, /sociales/, /sociali/],
    personalization: [/personaliz/, /personalis/, /spersonaliz/, /\bprofil/, /dopasowan/, /content profile/],
    functional: [/funkcjonal/, /funkcj/, /preferenc/, /funcional/, /functional/, /functionality/, /preference/, /funktional/, /funktion/, /praferenz/, /komfort/, /fonctionnel/, /funzional/, /preferenz/, /functioneel/, /voorkeur/, /funkcni/],
    thirdParty: [/partner/, /dostawc/, /vendor/, /third.?part/, /stron trzecich/, /podmiot\w* trzeci/, /dritt/, /\btiers\b/, /tercer/, /terze parti/, /derden/, /tretich stran/]
  };
  // kolejność sprawdzania (pierwsze dopasowanie wygrywa)
  const CAT_ORDER = ['legitimateInterest', 'necessary', 'marketing', 'analytics', 'social', 'personalization', 'functional', 'thirdParty'];

  // Przełączniki "zaznacz wszystkie" — pomijamy, ustawiamy pojedynczo.
  const TOGGLE_SKIP = [
    /(zaznacz|wybierz|select|toggle|wlacz|wylacz|alle) (wszystk|all|alle)/, /^(all|wszystkie|alle|tous|todos|tutti)$/, /(accept|akceptuj|zaakceptuj|odrzuc|reject) (wszystk|all)/
  ];

  // ---------- znane CMP ----------
  // detect: selektor korzenia banera; panel: selektor panelu ustawień; pozostałe: selektory przycisków.
  const CMPS = [
    { name: 'OneTrust', detect: '#onetrust-banner-sdk, #onetrust-pc-sdk', panel: '#onetrust-pc-sdk',
      reject: '#onetrust-reject-all-handler, .ot-pc-refuse-all-handler', settings: '#onetrust-pc-btn-handler',
      save: '.save-preference-btn-handler', accept: '#onetrust-accept-btn-handler' },
    { name: 'Cookiebot', detect: '#CybotCookiebotDialog', api: 'cookiebot', panel: '#CybotCookiebotDialog',
      reject: '#CybotCookiebotDialogBodyButtonDecline', settings: '#CybotCookiebotDialogBodyLevelButtonCustomize, #CybotCookiebotDialogNavDetails',
      save: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection, #CybotCookiebotDialogBodyButtonAcceptSelected',
      accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll' },
    { name: 'Usercentrics', detect: '#usercentrics-root, #usercentrics-cmp-ui', api: 'usercentrics',
      reject: '[data-testid="uc-deny-all-button"]', settings: '[data-testid="uc-more-button"]',
      save: '[data-testid="uc-save-button"]', accept: '[data-testid="uc-accept-all-button"]' },
    { name: 'Didomi', detect: '#didomi-host .didomi-popup-container, #didomi-notice, #didomi-popup', panel: '#didomi-popup, .didomi-consent-popup-preferences',
      reject: '#didomi-notice-disagree-button, .didomi-continue-without-agreeing, [aria-label*="disagree" i]',
      settings: '#didomi-notice-learn-more-button', save: '.didomi-consent-popup-actions .didomi-button-highlight, [aria-label*="save" i]',
      accept: '#didomi-notice-agree-button' },
    { name: 'Quantcast', detect: '.qc-cmp2-container, #qc-cmp2-container', panel: '.qc-cmp2-container' },
    { name: 'Google FC', detect: '.fc-consent-root', panel: '.fc-consent-root',
      reject: '.fc-cta-do-not-consent', settings: '.fc-cta-manage-options', save: '.fc-confirm-choices', accept: '.fc-cta-consent' },
    { name: 'TrustArc', detect: '#truste-consent-track, .truste_box_overlay', reject: '#truste-consent-required', settings: '#truste-show-consent', accept: '#truste-consent-button' },
    { name: 'CookieYes', detect: '.cky-consent-container, .cky-modal', panel: '.cky-preference-center, .cky-modal',
      reject: '.cky-btn-reject', settings: '.cky-btn-customize', save: '.cky-btn-preferences', accept: '.cky-btn-accept' },
    { name: 'Complianz', detect: '.cmplz-cookiebanner:not(.cmplz-hidden)', reject: '.cmplz-deny', settings: '.cmplz-view-preferences',
      save: '.cmplz-save-preferences', accept: '.cmplz-accept' },
    { name: 'Klaro', detect: '.klaro .cookie-notice, .klaro .cookie-modal', panel: '.klaro .cookie-modal',
      reject: '.cn-decline, .cm-btn-decline', settings: '.cn-learn-more', save: '.cm-btn-accept:not(.cm-btn-accept-all)', accept: '.cm-btn-accept-all, .cm-btn-success' },
    { name: 'Osano', detect: '.osano-cm-window', reject: '.osano-cm-denyAll, .osano-cm-deny', settings: '.osano-cm-manage', save: '.osano-cm-save', accept: '.osano-cm-accept-all' },
    { name: 'iubenda', detect: '#iubenda-cs-banner', reject: '.iubenda-cs-reject-btn', settings: '.iubenda-cs-customize-btn', accept: '.iubenda-cs-accept-btn' },
    { name: 'consentmanager', detect: '#cmpbox', reject: '.cmpboxbtnno', settings: '.cmpboxbtncustom', save: '.cmpboxbtnsave', accept: '.cmpboxbtnyes' },
    { name: 'Borlabs', detect: '#BorlabsCookieBox ._brlbs-block-content, #BorlabsCookieBox .brlbs-cmpnt-dialog', reject: '._brlbs-refuse-btn a, ._brlbs-refuse a, [data-cookie-refuse]', settings: '[data-cookie-individual]' },
    { name: 'Axeptio', detect: '#axeptio_overlay .axeptio_widget, #axeptio_main_button', reject: '#axeptio_btn_dismiss', settings: '#axeptio_btn_configure', accept: '#axeptio_btn_acceptAll' },
    { name: 'CookieFirst', detect: '.cookiefirst-root', reject: '[data-cookiefirst-action="reject"]', settings: '[data-cookiefirst-action="adjust"]', save: '[data-cookiefirst-action="save"]', accept: '[data-cookiefirst-action="accept"]' },
    { name: 'Cookie Script', detect: '#cookiescript_injected', reject: '#cookiescript_reject', settings: '#cookiescript_manage', save: '#cookiescript_save', accept: '#cookiescript_accept' },
    { name: 'Termly', detect: '[class^="termly-styles-root"]' },
    { name: 'Sourcepoint', detect: '.message-container[data-sp-message], #sp_message_container_body, .sp_message_container' }
  ];

  g.CCR_RULES = {
    BTN_REJECT, BTN_SAVE, WORD_ALL, BTN_PAY, BTN_ACCEPT, BTN_SETTINGS, BTN_CLOSE, BTN_OBJECT_ALL,
    TXT_STRONG, TXT_WEAK, TXT_PAY, CAT, CAT_ORDER, TOGGLE_SKIP, CMPS
  };
})(globalThis);
