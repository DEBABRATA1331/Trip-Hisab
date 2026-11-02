# Trip Hisab ✈️

A clean, responsive, and reliable group trip expense tracker and hisab manager designed for groups of friends. Built with an offline-first architecture, individual reports, isolated personal expenses, group kitty pool fund, undo/redo mistake recovery, and live Google Sheets database auto-sync.

## 🚀 Key Features

- **No Data Loss (Offline-First)**: Auto-persists locally on every change so hisab is never lost even without internet.
- **Google Sheets Database Auto-Sync**: Real-time sync to your Google Sheet with automatically formatted human-readable tabs:
  - *Trip Overview* (Total spend, Kitty balance, member balances)
  - *Group Expenses* (Date-wise shared ledger)
  - *Personal Expenses* (Solo expenses kept separate from group calculations)
  - *Group Kitty (Pool)* (Contributions and cash withdrawals ledger)
  - *Settlement Guide* (Who pays whom)
  - *Notes & Contacts* (Driver numbers, booking IDs)
- **Flexible Member Management**: Easily add, rename, or remove travel friends anytime.
- **Whom to Split With**: Select specific friends per bill with instant per-person share calculation.
- **Personal Expenses**: Keep solo shopping or snacks separate so they don't affect anyone else's dues.
- **Group Kitty / Pool**: Add deposits, withdraw cash for tolls, or modify the common fund.
- **Individual Reports & WhatsApp Sharing**: View individual net balances (Gets Back vs Owes) and 1-click share to WhatsApp.
- **Smart Debt Simplification**: Solves the Minimum Cash Flow problem to settle all debts in the fewest transactions.
- **Important Numbers & Notes**: Quick phonebook for drivers, hotels, and booking PNRs with Call and Copy buttons.
- **Undo / Redo for Mistakes**: Revert accidental additions, edits, or deletions with Ctrl+Z / Ctrl+Y.
- **Clean Aesthetic**: White, black, and royal blue theme with minimalist SVG icons and zero distraction.

## 🛠️ Tech Stack

- **Frontend**: HTML5, Vanilla JavaScript (ES Modules), Vanilla CSS
- **Bundler**: Vite
- **Database / Sync**: Google Sheets via Google Apps Script Web App
- **Icons**: Clean Vector SVGs (Feather/Lucide style)

## 📦 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- npm

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/DEBABRATA1331/Trip-Hisab.git
cd Trip-Hisab

# Install dependencies
npm install

# Run development server
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build for Production

```bash
npm run build
```

## 📊 Google Sheets Setup

1. Create a blank Google Sheet at [sheets.new](https://sheets.new).
2. Go to **Extensions ➔ Apps Script**.
3. Paste the contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs) into `Code.gs`.
4. Click **Deploy ➔ New deployment ➔ Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the generated Web App URL and paste it into the app under **Settings & Sheets ➔ Google Apps Script Web App URL**.
