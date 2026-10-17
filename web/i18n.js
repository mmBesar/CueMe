/* Tiny i18n: English + Arabic. UI text only; scripts keep their own direction. */
(function (root) {
  'use strict';
  var T = {
    en: {
      display: 'Display', remote: 'Remote',
      display_hint: 'Show the script here. Works on its own too: tap the screen for controls',
      remote_hint: 'Control a CueMe display',
      connect: 'Connect', host: 'Address (e.g. 192.168.1.20:7878)', pin: 'PIN',
      nearby: 'Nearby CueMe', none_found: 'Nothing found - type the address',
      connecting: 'Connecting...', connected: 'Connected', offline: 'Offline - retrying',
      bad_pin: 'Wrong PIN', back: 'Back', this_device: 'This device',
      displays: 'displays', remotes: 'remotes', no_display: 'No display connected',
      play: 'Play', pause: 'Pause', top: 'Top', prev: 'Previous heading', next: 'Next heading',
      jog: 'Jog (release to stop)', scrub: 'Position', left: 'left',
      controls: 'Controls', script: 'Script', link: 'Connect',
      font_size: 'Text size', speed: 'Speed', width: 'Text width', dim: 'Dim', focus_pos: 'Cue line position',
      flip_x: 'Mirror (flip X)', flip_y: 'Flip Y', bold: 'Bold', focus: 'Focus band',
      text_color: 'Text color', bg_color: 'Background', countdown: 'Countdown (s)',
      auto_fullscreen: 'Fullscreen on play', fullscreen: 'Fullscreen',
      edit: 'Edit', preview: 'Preview', send: 'Send to display', save: 'Save', file_name: 'File name',
      library: 'Library', load: 'Load', del: 'Delete', empty_lib: 'No scripts yet',
      confirm_del: 'Delete this file?', saved: 'Saved', hide: 'Hide',
      scan_other: 'Open this address on another device', menu: 'Menu', cancel: 'Cancel',
      empty_script: 'No script yet. Tap the screen for controls, or open the menu to write or load one.',
      theme: 'Theme (Catppuccin)', theme_script: 'Use theme colours for the script',
      hide_controls: 'Hide controls', show_controls: 'Show controls', controls_hidden: 'Controls hidden. Tap the small dot to bring them back',
      outline: 'Outline', outline_empty: 'No headings in this script. Start a line with # to make a heading.',
      fs_tap: 'Tap the display once, then try again', scan: 'Scan QR', scan_hint: 'Point the camera at the QR code on the display',
      scan_bad: 'That is not a CueMe code', scan_fail: 'Camera not available', saved_in: 'Scripts are saved in:',
      lang: 'العربية', keys: 'Keys: Space play/pause, Up/Down scroll, Left/Right speed, Alt+Up/Down size, [ ] width, Alt+F fullscreen, Alt+E edit, M menu'
    },
    ar: {
      display: 'عرض', remote: 'تحكم',
      display_hint: 'اعرض النص هنا. يعمل بمفرده أيضًا: المس الشاشة لإظهار التحكم',
      remote_hint: 'تحكّم في شاشة CueMe أخرى',
      connect: 'اتصال', host: 'العنوان (مثال 192.168.1.20:7878)', pin: 'الرمز',
      nearby: 'أجهزة CueMe القريبة', none_found: 'لا شيء - اكتب العنوان',
      connecting: 'جارٍ الاتصال...', connected: 'متصل', offline: 'غير متصل - إعادة المحاولة',
      bad_pin: 'الرمز غير صحيح', back: 'رجوع', this_device: 'هذا الجهاز',
      displays: 'شاشات', remotes: 'أجهزة تحكم', no_display: 'لا توجد شاشة متصلة',
      play: 'تشغيل', pause: 'إيقاف', top: 'البداية', prev: 'العنوان السابق', next: 'العنوان التالي',
      jog: 'تحريك (اتركه ليتوقف)', scrub: 'الموضع', left: 'متبقٍ',
      controls: 'الإعدادات', script: 'النص', link: 'الاتصال',
      font_size: 'حجم الخط', speed: 'السرعة', width: 'عرض النص', dim: 'التعتيم', focus_pos: 'موضع خط التركيز',
      flip_x: 'مرآة (قلب أفقي)', flip_y: 'قلب رأسي', bold: 'خط عريض', focus: 'نطاق التركيز',
      text_color: 'لون النص', bg_color: 'الخلفية', countdown: 'العد التنازلي (ث)',
      auto_fullscreen: 'ملء الشاشة عند التشغيل', fullscreen: 'ملء الشاشة',
      edit: 'تحرير', preview: 'معاينة', send: 'إرسال إلى الشاشة', save: 'حفظ', file_name: 'اسم الملف',
      library: 'المكتبة', load: 'فتح', del: 'حذف', empty_lib: 'لا توجد نصوص بعد',
      confirm_del: 'حذف هذا الملف؟', saved: 'تم الحفظ', hide: 'إخفاء',
      scan_other: 'افتح هذا العنوان على جهاز آخر', menu: 'القائمة', cancel: 'إلغاء',
      empty_script: 'لا يوجد نص بعد. المس الشاشة لإظهار التحكم، أو افتح القائمة لكتابة نص أو تحميله.',
      theme: 'السمة (Catppuccin)', theme_script: 'استخدم ألوان السمة للنص',
      hide_controls: 'إخفاء الأزرار', show_controls: 'إظهار الأزرار', controls_hidden: 'تم إخفاء الأزرار. المس النقطة الصغيرة لإعادتها',
      outline: 'الفهرس', outline_empty: 'لا توجد عناوين في هذا النص. ابدأ السطر بعلامة # لإنشاء عنوان.',
      fs_tap: 'المس شاشة العرض مرة ثم أعد المحاولة', scan: 'مسح رمز QR', scan_hint: 'وجّه الكاميرا إلى رمز QR على شاشة العرض',
      scan_bad: 'هذا ليس رمز CueMe', scan_fail: 'الكاميرا غير متاحة', saved_in: 'تُحفظ النصوص في:',
      lang: 'English', keys: 'اختصارات: مسافة تشغيل/إيقاف، أعلى/أسفل تمرير، يمين/يسار سرعة، Alt+أعلى/أسفل الحجم، [ ] العرض، Alt+F ملء الشاشة، Alt+E تحرير، M القائمة'
    }
  };
  var lang = 'en';
  try {
    var saved = localStorage.getItem('cueme_lang');
    if (saved === 'ar' || saved === 'en') lang = saved;
    else if (/^ar/i.test(navigator.language || '')) lang = 'ar';
  } catch (e) {}
  var api = {
    t: function (k) { return (T[lang] && T[lang][k]) || T.en[k] || k; },
    lang: function () { return lang; },
    toggle: function () {
      lang = lang === 'ar' ? 'en' : 'ar';
      try { localStorage.setItem('cueme_lang', lang); } catch (e) {}
      return lang;
    },
    dict: T
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CueI18n = api;
})(typeof window !== 'undefined' ? window : this);
