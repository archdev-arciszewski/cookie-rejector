/* Słowniki heurystyk (PL/EN/DE/FR/ES/IT/NL/CS) i reguły znanych CMP.
 * Wszystkie wzorce działają na tekście znormalizowanym: małe litery, bez polskich znaków (ł→l), pojedyncze spacje. */
(function (g) {
  'use strict';

  // ---------- przyciski ----------
  const BTN_REJECT = [
    /\bodrzuc/, /\bodrzucam/, /\bodmawiam/, /\bodmow/, /nie zgadzam/, /nie akceptuj/, /nie wyrazam zgody/, /nie zezwalam/,
    /(tylko|wylacznie|jedynie) (niezbedne|wymagane|konieczne|podstawowe|techniczne)/,
    /(akceptuj|zaakceptuj|zezwol na|zgoda na|uzywaj|potwierdz\w*|zapisz) (tylko |wylacznie |jedynie )?(niezbedne|wymagane|konieczne|podstawowe)/,
    /kontynuuj bez/, /przejdz dalej bez/, /bez (akceptacji|zgody)/,
    /\breject/, /\bdeclin/, /\bdeny\b/, /\brefuse/, /\bdisagree/, /do not (accept|agree|consent)/, /don.?t (accept|agree|consent)/,
    /(only|just|accept|use|allow) (strictly )?(necessary|essential|required)/, /\b(accept|allow|use) (only|just) (the )?(strictly )?(necessary|essential|required)/, /(necessary|essential|required)( cookies)? only/,
    /continue without/, /\bopt.?out\b/, /\bno,? thanks\b/,
    /ablehn/, /nicht (zustimmen|akzeptieren|einverstanden)/, /nur (notwendig|essenziell|erforderlich|technisch)/, /ohne (zustimmung|einwilligung)/, /verweiger/,
    /\brefuser/, /\btout refuser/, /continuer sans/, /je refuse/, /seulement (les )?(necessaires|essentiels)/,
    /\brechaz/, /\bdenegar/, /solo (las )?(necesarias|esenciales)/, /continuar sin/,
    /\brifiut/, /\bnega\b/, /solo (i )?(necessari|essenziali|tecnici)/, /continua senza/,
    /\bweiger/, /\bafwijzen/, /alleen (noodzakelijk|essentieel|functioneel)/,
    /\bodmitn/, /pouze nezbytn/, /\bnesouhlas/,
    // nordyckie, PT, HU, RO, SK
    /\bafvis/, /\bavvisa/, /\bavvis\b/, /\bavvis alle/, /\bhylkaa/, /(kun|bare|bara|endast|kun de) n.dv.ndig/, /vain valttamatt/,
    /\brejeitar/, /\brecusar/, /apenas (os )?(necessarios|essenciais)/, /\belutasit/, /csak a szukseges/, /\brespinge/, /\bodmietnut/, /iba nevyhnutn/,
    // „odznacz wszystko” (np. Evidon: przycisk odmowy w panelu)
    /odznacz wszystk/, /tout decocher/, /\b(uncheck|deselect) all\b/, /alle abwahlen/
  ];

  const BTN_SAVE = [
    /\bzapisz/, /\bzapisuj/, /\bzapisac/, /\bzatwierdz/, /\bpotwierdz/, /(akceptuje?|zaakceptuj|zezwol na|zezwalam na|zapisz|potwierdz) (wybran|zaznaczon|moj wybor|wybor|moje ustawien)/,
    /\bsave\b/, /\bconfirm/, /(accept|allow) (selected|selection|my selection|current|chosen)/, /\bapply\b/, /\bsubmit\b/,
    /speicher/, /auswahl (bestatigen|erlauben|akzeptieren|zulassen|speichern)/, /\bbestatig/,
    /enregistr/, /\bvalider/, /\bconfirmer/,
    /\bguardar/, /\bconfirmar/,
    /\bsalva/, /\bconferm/,
    /\bopslaan/, /\bbevestig/, /accepteer (selectie|geselecteerd|mijn keuze)/,
    /\bulozit/, /\bpotvrdit/,
    /accepter (la |ma )?selection/, /(tillad|tillat|salli) (valgte|valda|valitut)/, /\bhyvaksy valitut/, /aceptar (la )?seleccion/, /accetta (la )?selezione/,
    /\bspara\b/, /\bgem\b/, /\blagre\b/, /\btallenna/, /\bguardar/, /\bgravar\b/, /\bmentes/
  ];

  // „Zapisz się” (newsletter), „Zarejestruj”, „Subscribe” — to nie jest zapis ustawień zgód
  const BTN_NOT_CONSENT = [
    /\bzapisz sie\b/, /\bzapisuje sie\b/, /newsletter/, /zarejestruj/, /zaloguj/, /\bsign ?(up|in)\b/, /\blog ?in\b/, /\bregister\b/,
    /anmelden/, /registrier/, /s'inscrire/, /\binscri/, /\bconnexion\b/, /iscriviti/, /accedi/, /aanmelden/, /inschrijven/, /prihlas/
  ];

  const WORD_ALL = [/wszystk/, /\ball\b/, /\balle\b/, /\btous\b/, /\btout\b/, /\btodas?\b/, /\btutt[ie]\b/, /\bvse\b/];

  const BTN_PAY = [
    /subskryb/, /subskrypc/, /abonament/, /\bwykup/, /zaplac/, /\bplac(e|ic|isz)\b/, /\boplat/, /\bkup (dostep|abonament|subskrypc)/, /bez reklam/, /\bpremium\b/,
    /subscri/, /\bpay\b/, /\bpayment/, /ad.?free/, /without ads/, /reject and (pay|subscribe)/,
    /\babo\b/, /abonnier/, /\bpur\b/, /werbefrei/, /ohne werbung/, /contentpass/, /\bzahlen/, /bezahl/,
    /s'abonner/, /\babonn/, /\bpayer\b/, /sans publicit/,
    /suscrib/, /\bpagar\b/, /sin publicidad/,
    /abbona/, /senza pubblicit/, /\bpagare\b/,
    /\bbetal/, /zonder advertenties/, /\babonneer/,
    /predplat/
  ];

  // "Nie chcę płacić, akceptuję" — przycisk z odmową płacenia to akceptacja, nie płatność
  const PAY_NEGATED = [
    /nie (chce |bede )?(placic|zaplacic|place)/, /bez (placenia|oplat)/, /(don'?t|do not) (want to )?pay/, /without pay/,
    /nicht (zahlen|bezahlen)/, /ohne (zu )?(zahlen|bezahlen)/, /sans payer/, /sin pagar/, /senza pagare/, /zonder (te )?betalen/
  ];

  // Nazwy metod płatności („Google Pay”, „PayPal”, „BLIK”…) — to nie jest „zapłać zamiast zgody”.
  const PAY_METHOD = [
    /\b(google|apple|samsung|amazon|garmin|revolut) ?pay\b/, /\bpaypal/, /\bpaypo\b/, /\bpayu\b/, /\bblik\b/, /\bvisa\b/, /mastercard/,
    /\bmaestro\b/, /american express/, /\bklarna\b/, /\btpay\b/, /przelewy ?24/, /\bp24\b/, /\bautopay\b/, /\bpaynow\b/, /\bdotpay\b/,
    /przelew (online|tradycyjny|bankowy)/, /platnosc (karta|blik|przelewem|online|odroczon)/, /karta (platnicza|kredytowa|debetowa)/,
    /click to pay/, /\bsofort\b/, /\bideal\b/, /\bbancontact\b/, /\btwint\b/, /\bskrill\b/, /paysafecard/, /\btrustly\b/
  ];

  // Strona/okno płatności: kwota do zapłaty, dane karty, regulamin operatora płatności.
  const TXT_CHECKOUT = [
    /do zaplaty/, /kwota (do zaplaty|zamowienia|transakcji)/, /numer karty/, /data waznosci/, /\bcvv\b/, /\bcvc\b/, /kod blik/,
    /wybierz (metode|sposob|forme) platnosci/, /metod[ay] platnosci/, /regulamin (przelewy24|payu|tpay|blik|autopay|paynow|dotpay)/,
    /amount due/, /total due/, /order total/, /card number/, /expiry date/, /security code/, /payment method/, /choose (a )?payment/,
    /zu zahlen/, /zahlungsart/, /kartennummer/, /montant a payer/, /moyen de paiement/, /importe a pagar/, /metodo de pago/
  ];

  const BTN_ACCEPT = [
    /\bakceptuj/, /\bzaakceptuj/, /\bakceptuje/, /\bpotwierdz\w* wszystk/, /\bconfirm all/, /alle bestatigen/, /\bzgadzam/, /przejdz do (serwisu|strony)/, /przechodze do (serwisu|strony)/,
    /\brozumiem/, /\bprzyjmuj/, /\bwlacz(am)? wszystk/, /wyrazam zgode/, /\bdaj zgode/, /\bzezwol/, /\bjasne\b/,
    /^ok\b/, /^okay\b/, /\baccept/, /\bagree/, /\ballow/, /^consent\b/, /^i consent/,/got it/, /\bi understand/, /^continue\b/, /^yes\b/,
    /akzeptier/, /zustimm/, /einverstanden/, /erlauben/, /zulassen/, /^weiter\b/,
    /\baccepter/, /j'accepte/, /d'accord/, /autoriser/, /^continuer\b/,
    /\bacept/, /de acuerdo/, /\bpermitir/,
    /\baccett/, /\bconsenti/, /\bacconsent/,
    /\bakkoord/, /accepteer/, /toestaan/,
    /\bsouhlas/, /\bprijmout/, /\bpovolit/,
    /\bhyvaksy/, /\bgodta/, /\btillat/, /\btillad/, /\baceitar/, /\belfogad/
  ];

  const BTN_SETTINGS = [
    /ustawien/, /\bdostosuj/, /zarzadz/, /preferencj/, /wiecej opcji/, /\bopcje\b/, /szczegol/, /personalizuj/, /\bkonfigur/, /dowiedz sie wiecej/, /\bwiecej\b/,
    /settings/, /\bcustomi[sz]/, /\bmanage/, /preferences/, /\boptions\b/, /\bdetails\b/, /configur/, /learn more/, /show purposes/, /\bmore\b/,
    /einstellung/, /\banpass/, /verwalt/, /individuell/, /mehr optionen/, /\bdetails\b/,
    /parametr/, /personnalis/, /\bgerer/, /en savoir plus/,
    /configurar/, /personalizar/, /\bgestion/, /mas opciones/,
    /gestisci/, /impostazion/, /personalizz/, /piu opzioni/,
    /instelling/, /\baanpass/, /\bbeheer/,
    /nastaven/, /\bupravit/, /podrobnost/,
    /ustaw (swoje |moje )?wybory/, /auswahl treffen/, /\badjust\b/, /faire (vos|mes) choix/, /(set|make) (your )?choices/,
    /installningar/, /indstillinger/, /innstillinger/, /asetukset/, /\bdetaljer\b/, /\btilpas/, /\banpassa/, /pr.ferencer/, /\bpreferenser/,
    /\bmais opcoes/, /\bdefinicoes/, /\bpreferencias/,
    // zakładki „Cele” w okienkach TCF bez przycisku ustawień (np. Admiral) — tylko dokładna etykieta
    /^(cele|purposes|zwecke|finalites|finalidades|finalita|doelen|ucely)$/
  ];

  const BTN_CLOSE = /^(x|×|✕|✖|zamknij|close|schliessen|fermer|cerrar|chiudi|sluiten|zavrit|dismiss|luk|stang|sulje)$/;

  // „Sprzeciw wobec wszystkich” w sekcjach uzasadnionego interesu
  const BTN_OBJECT_ALL = [
    /sprzeciw/, /\bobjetar/, /\bopor-se\b/, /\boposicao/, /\bobject\b/, /object (to )?all/, /widerspr/, /\bopposer/, /\bs'opposer/, /\boponer/, /oposicion/, /\bopporsi/, /opposizione/, /bezwaar/, /\bnamitk/
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
    /abonament/, /\bplac(e|ic|isz)\b/, /zl ?\/ ?(mies|msc|miesiac)/, /\bzl miesiecznie/, /€ ?\/ ?(monat|month|mois)/, /\bpro monat\b/, /per month/, /\/ ?month/,
    /subskrypc/, /subskryb/, /wykup (dostep|abonament|subskrypc)/, /\bzaplac/, /bez reklam/, /platn(y|a|e) (dostep|wersj|abonament)/,
    /subscri(be|ption)/, /\bpay\b/, /ad.?free/, /without ads/, /pay or (ok|accept)/, /reject and pay/,
    /\bpur\b/, /\bpur.?abo/, /werbefrei/, /ohne werbung/, /contentpass/, /abo abschliess/, /bezahl/,
    /sans publicit/, /\bs'abonner/, /sin publicidad/, /suscripcion/, /senza pubblicit/, /abbonament/, /zonder advertenties/, /predplatn/
  ];

  // ---------- klasyfikacja kategorii (etykiety przełączników) ----------
  const CAT = {
    legitimateInterest: [/uzasadnion/, /interesses? legitimos?/, /legitimt interess/, /oikeutettu etu/, /legitimate interest/, /\blegit\.? interest/, /berechtigt/, /interet legitime/, /interes legitimo/, /legittimo interesse/, /interesse legittimo/, /gerechtvaardigd belang/, /opravneny zajem/],
    necessary: [/niezbedn/, /n.dv.ndig/, /valttamatt/, /\bkoniecz/, /\bwymagan/, /scisle/, /techniczn/, /podstawow/, /\bnecessary/, /\bessential/, /\bstrictly/, /\brequired/, /\btechnical/, /notwendig/, /erforderlich/, /essenziell/, /technisch/, /necessaire/, /essentiel/, /necesari/, /esencial/, /tecnic/, /necessari/, /essenzial/, /noodzakelijk/, /essentieel/, /nezbytn/, /\bnutn/],
    marketing: [/marketing/, /markedsf/, /marknadsf/, /markkinoin/, /reklam/, /advertis/, /\bads?\b/, /targeting/, /targetow/, /ukierunkow/, /werbung/, /\bwerbe/, /publicit/, /publicidad/, /pubblicit/, /advertentie/, /reclame/, /retarget/, /remarketing/, /\bad (selection|measurement|profile)/],
    analytics: [/analit/, /analyt/, /statyst/, /statist/, /wydajnos/, /\bpomiar/, /mierzen/, /\bperformance/, /\bmeasure/, /audience/, /leistung/, /\bmessung/, /\bmesure/, /rendimiento/, /medicion/, /prestazion/, /misurazion/, /prestaties/, /\bmeten\b/, /\bvykon/, /\bmereni/],
    social: [/spolecznosc/, /social/, /soziale/, /sociaux/, /sociales/, /sociali/],
    personalization: [/personaliz/, /personalis/, /spersonaliz/, /\bprofil/, /dopasowan/, /content profile/],
    functional: [/funkcjonal/, /funkcj/, /preferenc/, /funcional/, /functional/, /functionality/, /preference/, /funktional/, /funktion/, /praferenz/, /komfort/, /fonctionnel/, /funzional/, /preferenz/, /functioneel/, /voorkeur/, /funkcni/],
    thirdParty: [/partner/, /dostawc/, /vendor/, /third.?part/, /stron trzecich/, /podmiot\w* trzeci/, /dritt/, /\btiers\b/, /tercer/, /terze parti/, /derden/, /tretich stran/]
  };
  // Cele i funkcje specjalne TCF (IAB) — sprawdzane przed CAT, bo ich nazwy mylą ogólne słowniki:
  // „Funkcje specjalne” (geolokalizacja, skanowanie urządzenia) to NIE są cookies funkcjonalne,
  // a „Przechowywanie informacji na urządzeniu” (cel 1) dotyczy dostawców, nie działania strony.
  const TCF_CAT = [
    [/geolokaliz|geolocali[sz]|standortdaten|geolocalizaci|geolocalizzazion|geolocatie|precise location/, 'marketing'],
    [/skanowani\w* (aktywn\w* )?(charakterystyk|urzadzen)|aktywn\w* skanowani|aktywnie zadanych|actively scan|scan(ning)? (the )?device|endgerateeigenschaften|geraeteeigenschaften|analyser activement|analizar activamente|scansione attiva|actief scannen/, 'marketing'],
    [/funkcje specjaln|special features?\b|besondere merkmale|fonctionnalites speciales|caracteristicas especiales|funzionalita speciali|speciale (functies|kenmerken)|zvlastni funkce/, 'marketing'],
    [/przechowywanie (informacji )?na urzadzeniu|informacji na urzadzeniu lub dostep|store and\/or access information|speichern von (und\/)?oder zugriff auf informationen|zugriff auf informationen auf (einem|ihrem) endgerat|stocker (et\/ou acceder a )?des informations|almacenar (la )?informacion en un dispositivo|archiviare e\/o accedere|informatie op een apparaat (op)?slaan|ukladani informaci/, 'thirdParty']
  ];

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
      save: '.save-preference-btn-handler', accept: '#onetrust-accept-btn-handler',
      // sprzeciw wobec uzasadnionego interesu przy każdym celu (przyciski w zwiniętych sekcjach — klikane także ukryte)
      objectLI: '#onetrust-pc-sdk .ot-obj-leg-btn-handler.ot-leg-int-enabled' },
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
    // InMobi Choice (dawniej Quantcast): „Odrzucenie” w drugiej warstwie tylko przestawia przełączniki — potem „Zapisz i wyjdź”
    { name: 'Quantcast', detect: '#qc-cmp2-ui, .qc-cmp2-container, #qc-cmp2-container', panel: '#qc-cmp2-ui',
      reject: '#disagree-btn', settings: '#more-options-btn' },
    { name: 'Google FC', detect: '.fc-consent-root', panel: '.fc-consent-root',
      reject: '.fc-cta-do-not-consent', settings: '.fc-cta-manage-options', save: '.fc-confirm-choices', accept: '.fc-cta-consent' },
    // .truste_box_overlay to tylko opakowanie ramki centrum preferencji — obsługuje ją skrypt w ramce
    { name: 'TrustArc', detect: '#truste-consent-track', reject: '#truste-consent-required', settings: '#truste-show-consent', accept: '#truste-consent-button' },
    { name: 'CookieYes', detect: '.cky-consent-container, .cky-modal', panel: '.cky-preference-center, .cky-modal',
      reject: '.cky-btn-reject, [data-cky-tag="reject-button"]', settings: '.cky-btn-customize, [data-cky-tag="settings-button"]',
      save: '.cky-btn-preferences, [data-cky-tag="detail-save-button"]', accept: '.cky-btn-accept, [data-cky-tag="accept-button"]' },
    { name: 'Complianz', detect: '.cmplz-cookiebanner:not(.cmplz-hidden)', reject: '.cmplz-deny', settings: '.cmplz-view-preferences',
      save: '.cmplz-save-preferences', accept: '.cmplz-accept' },
    { name: 'Klaro', detect: '.klaro .cookie-notice, .klaro .cookie-modal', panel: '.klaro .cookie-modal',
      reject: '.cn-decline, .cm-btn-decline', settings: '.cn-learn-more', save: '.cm-btn-accept:not(.cm-btn-accept-all)', accept: '.cm-btn-accept-all, .cm-btn-success' },
    { name: 'Osano', detect: '.osano-cm-window', reject: '.osano-cm-denyAll, .osano-cm-deny', settings: '.osano-cm-manage', save: '.osano-cm-save', accept: '.osano-cm-accept-all' },
    { name: 'iubenda', detect: '#iubenda-cs-banner', reject: '.iubenda-cs-reject-btn', settings: '.iubenda-cs-customize-btn', accept: '.iubenda-cs-accept-btn' },
    { name: 'consentmanager', detect: '#cmpbox',
      // warstwa ustawień: „Zapisz i wyjdź” ma też klasę .cmpboxbtnyes, a „Odrzuć wszystko” to .cmpboxbtnreject
      reject: '.cmpboxbtnno, .cmpboxbtnreject, .cmptxt_btn_no', settings: '.cmpboxbtncustom',
      save: '.cmpboxbtnsave, .cmpboxbtnyescustomchoices, .cmptxt_btn_save',
      accept: '.cmpboxbtnyes:not(.cmpboxbtnyescustomchoices):not(.cmptxt_btn_save)' },
    { name: 'Borlabs', detect: '#BorlabsCookieBox ._brlbs-block-content, #BorlabsCookieBox .brlbs-cmpnt-dialog', reject: '._brlbs-refuse-btn a, ._brlbs-refuse a, [data-cookie-refuse]', settings: '[data-cookie-individual]' },
    { name: 'Axeptio', detect: '#axeptio_overlay .axeptio_widget', reject: '#axeptio_btn_dismiss', settings: '#axeptio_btn_configure', accept: '#axeptio_btn_acceptAll' },
    { name: 'CookieFirst', detect: '.cookiefirst-root', reject: '[data-cookiefirst-action="reject"]', settings: '[data-cookiefirst-action="adjust"]', save: '[data-cookiefirst-action="save"]', accept: '[data-cookiefirst-action="accept"]' },
    { name: 'Cookie Script', detect: '#cookiescript_injected', reject: '#cookiescript_reject', settings: '#cookiescript_manage', save: '#cookiescript_save', accept: '#cookiescript_accept' },
    { name: 'Termly', detect: '[class^="termly-styles-root"]' },
    // Sourcepoint: okienko i menedżer prywatności w ramce; typ wyboru w klasie przycisku (9 = subskrypcja, 11 = akceptuj, 12 = ustawienia, 13 = odrzuć)
    { name: 'Sourcepoint', detect: '.message-container[data-sp-message], #sp_message_container_body, .sp_message_container, .message-container:has([class*="sp_choice_type_"]), #privacy-manager.message-container',
      panel: '#privacy-manager.message-container',
      reject: '.sp_choice_type_13, .sp_choice_type_REJECT_ALL', settings: '.sp_choice_type_12', save: '.sp_choice_type_SAVE_AND_EXIT, .sp_choice_type_SE',
      accept: '.sp_choice_type_11, .sp_choice_type_ACCEPT_ALL', pay: '.sp_choice_type_9' },
    { name: 'Cookie Information', detect: '#coiOverlay, #ccb-coiOverlay, #coiConsentBanner', reject: '.coi-banner__decline, #declineButton', save: '#updateButton', accept: '.coi-banner__accept' },
    { name: 'Piwik PRO', detect: '[id^="ppms_cm_consent_popup"], #ppms_cm_popup_overlay', reject: '.ppms_cm_reject-all, #ppms_cm_reject-all', save: '#ppms_cm_save-choices, .ppms_cm_save-choices', accept: '.ppms_cm_agree-to-all, #ppms_cm_agree-to-all' },
    { name: 'Evidon', detect: '#_evidon-barrier-wrapper, #_evidon_banner, #evidon-prefdiag-overlay', panel: '#evidon-prefdiag-overlay',
      reject: '#_evidon-decline-button, .evidon-prefdiag-declinebtn, .evidon-barrier-declinebutton', settings: '#_evidon-banner-cookiebutton, .evidon-barrier-cookiebutton',
      accept: '#_evidon-accept-button, .evidon-prefdiag-acceptbtn, .evidon-barrier-acceptbutton' },
    { name: 'Silktide', detect: '#silktide-wrapper', reject: '#silktide-wrapper .reject-all, #silktide-wrapper .preferences-reject-all', settings: '#silktide-wrapper button.preferences', accept: '#silktide-wrapper .accept-all' },
    { name: 'Civic', detect: '#ccc-notify, #ccc-module, #ccc-overlay', panel: '#ccc-module', reject: '.ccc-reject-button, #ccc-reject-settings', accept: '.ccc-accept-button, #ccc-recommended-settings, #ccc-notify-accept' },
    { name: 'Moove GDPR', detect: '#moove_gdpr_cookie_info_bar:not(.moove-gdpr-info-bar-hidden), #moove_gdpr_cookie_modal.gdpr_lightbox-hide-not', panel: '#moove_gdpr_cookie_modal',
      reject: '.moove-gdpr-infobar-reject-btn', settings: '.change-settings-button', save: '.moove-gdpr-modal-save-settings', accept: '.moove-gdpr-infobar-allow-all' },
    { name: 'Sirdata', detect: '#sd-cmp [role="dialog"], #sd-cmp-dialog-main' },
    { name: 'Clickio', detect: '#cl-consent .cl-consent-popup, #cl-consent.cl-consent-visible', reject: '[data-role="b_disagree"]', settings: '[data-role="b_options"]', save: '[data-role="b_save"]', accept: '[data-role="b_agree"]' },
    { name: 'Ezoic', detect: '#ez-cookie-dialog-wrapper', settings: '#ez-manage-settings', save: '#ez-save-settings', accept: '#ez-accept-all' },
    { name: 'Enzuzo', detect: '#ez-cookie-notification', reject: '#ez-cookie-notification__decline', accept: '#ez-cookie-notification__accept' },
    { name: 'Ketch', detect: '#lanyard_root div[role="dialog"], #ketch-banner, #ketch-modal', reject: '#ketch-banner-button-tertiary, button[aria-label^="Reject" i]', settings: '#ketch-banner-button-secondary' }
  ];

  g.CCR_RULES = {
    BTN_REJECT, BTN_SAVE, BTN_NOT_CONSENT, WORD_ALL, BTN_PAY, PAY_NEGATED, PAY_METHOD, TXT_CHECKOUT, BTN_ACCEPT, BTN_SETTINGS, BTN_CLOSE, BTN_OBJECT_ALL,
    TXT_STRONG, TXT_WEAK, TXT_PAY, CAT, TCF_CAT, CAT_ORDER, TOGGLE_SKIP, CMPS
  };
})(globalThis);
