# GalStrike: משחק תלת-ממד של סווינג בעיר, בדפדפן

<p align="center">
  <a href="https://galasulin.github.io/galstrike/"><img src="https://img.shields.io/badge/▶%20Play%20now-live%20demo-e3262f?style=for-the-badge" alt="Play now"/></a>
  <img src="https://img.shields.io/badge/Three.js-WebGL2-000000?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js"/>
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite"/>
  <img src="https://img.shields.io/badge/Claude%20Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code"/>
</p>

**GalStrike** הוא משחק עולם פתוח שרץ בדפדפן. מתנדנדים על קורים מעל מנהטן, רצים על קירות ועוצרים פשעים ברחובות.

### ▶ [לשחק עכשיו בדפדפן](https://galasulin.github.io/galstrike/)
<sub>המשחק כבד מבחינה גרפית ומומלץ כרטיס מסך נפרד. בלפטופ עם שני כרטיסים כדאי להגדיר ל-Chrome להשתמש בכרטיס החזק (NVIDIA Control Panel ואז Manage 3D settings). הטעינה הראשונה לוקחת כדקה.</sub>

פרויקט של **גל אסולין** ([@galasulin](https://github.com/galasulin)). הקוד נכתב באמצעות **Claude** (מודל ה-AI של Anthropic, דרך Claude Code) בהכוונת אדם.

## מה יש במשחק
- **תנועה:** סווינג על קורים, ריצה על קירות, זינוק ותנועת "זיפ", עם מנוע פיזיקה ואנימציה מותאם.
- **העיר:** אי בסגנון מנהטן שנוצר פרוצדורלית, עם אלפי בניינים, גגות, פארקים, טיימס סקוור, גשרים, תנועה והולכי רגל.
- **גרפיקה:** Three.js (WebGL2) עם צללים, תאורה גלובלית, השתקפויות, bloom ו-motion blur, ומצבי שעות יום (כולל לילה וגשם).
- **חליפות:** Advanced, Iron Spider ו-Symbiote, ובנוסף **חליפת ישראל**, **Captain America** ו-**Iron Man**.
- **תפריט פתיחה**, ובחירת איכות גרפיקה אוטומטית לפי כרטיס המסך, עם רזולוציה דינמית כדי שהמשחק לא ייתקע.

## איך מריצים
צריך Node.js בגרסה 20.19 ומעלה או 22.12 ומעלה, ודפדפן שתומך ב-WebGL2. מומלץ כרטיס מסך נפרד.

```bash
npm install
npm run dev      # ואז לפתוח http://127.0.0.1:5173
npm run build    # בנייה לפרודקשן לתיקייה dist/
```

## שליטה
- **מקלדת ועכבר:**
  - WASD: תזוזה
  - עכבר: מצלמה
  - לחצן ימני או R: סווינג
  - Space: קפיצה
  - Shift: ריצה על קירות
  - E: זיפ
  - H: מסך עזרה
  - Esc: תפריט
- **שלט (Xbox או PlayStation):**
  - סטיק שמאלי: תזוזה
  - סטיק ימני: מצלמה
  - R2: סווינג
  - A: קפיצה
  - Start: תפריט

## הבהרה
פרויקט מעריצים לא רשמי ולא מסחרי, להדגמה טכנית בלבד. הוא לא קשור ל-Marvel, Disney, Sony או Insomniac Games, והן לא אישרו או מימנו אותו. Spider-Man, Captain America, Iron Man והשמות, הדמויות והמראה שקשורים אליהם הם סימנים מסחריים וחומר מוגן בזכויות יוצרים של בעליהם, ואין כאן שום טענה לזכויות בהם. הפונטים המצורפים זמינים תחת רישיון SIL Open Font License (ראו `public/assets/ui/fonts/`).

ראו [LICENSE](LICENSE).
