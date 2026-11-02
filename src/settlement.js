// =========================================================================
// TRIP HISAB - SETTLEMENT ENGINE & REPORT CALCULATOR
// =========================================================================

/**
 * Calculates net balances, personal spends, and debt breakdowns for all members
 */
export function calculateTripSummary(state) {
  const members = state.members || [];
  const expenses = state.expenses || [];
  const settlements = (state.settlements || []).filter(s => s.settled);
  const currency = state.currency || '₹';

  // Map to hold running totals for each member
  const memberMap = {};
  members.forEach(m => {
    memberMap[m.id] = {
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      color: m.color,
      paidForGroup: 0,
      shareOfGroup: 0,
      personalSpend: 0,
      netGroupBalance: 0, // (+) gets money back, (-) owes money
      transactionsCount: 0,
      paidTransactions: [],
      sharedTransactions: [],
      personalTransactions: []
    };
  });

  let totalGroupSpend = 0;
  let totalPersonalSpend = 0;
  const categoryTotals = {};

  // 1. Process Expenses
  expenses.forEach(exp => {
    const amount = Number(exp.amount) || 0;
    const cat = exp.category || 'Misc';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;

    if (exp.isPersonal) {
      // Personal Expense: isolated to payer
      totalPersonalSpend += amount;
      if (memberMap[exp.payerId]) {
        memberMap[exp.payerId].personalSpend += amount;
        memberMap[exp.payerId].personalTransactions.push(exp);
      }
      return;
    }

    // Group Expense
    totalGroupSpend += amount;

    // Credit Payer (unless paid by Kitty)
    if (exp.payerId !== 'KITTY') {
      if (memberMap[exp.payerId]) {
        memberMap[exp.payerId].paidForGroup += amount;
        memberMap[exp.payerId].paidTransactions.push(exp);
        memberMap[exp.payerId].transactionsCount++;
      }
    }

    // Debit Split Members
    const splitWith = exp.splitWith && exp.splitWith.length > 0
      ? exp.splitWith
      : members.map(m => m.id);

    if (exp.splitMode === 'CUSTOM' && exp.customSplits) {
      // Custom Unequal Split
      let assignedSum = 0;
      splitWith.forEach(mId => {
        const share = Number(exp.customSplits[mId]) || 0;
        assignedSum += share;
        if (memberMap[mId]) {
          memberMap[mId].shareOfGroup += share;
          memberMap[mId].sharedTransactions.push({ ...exp, myShare: share });
        }
      });
      // Any remaining amount split equally among participants
      const unassigned = amount - assignedSum;
      if (Math.abs(unassigned) > 0.01 && splitWith.length > 0) {
        const extraPerPerson = unassigned / splitWith.length;
        splitWith.forEach(mId => {
          if (memberMap[mId]) {
            memberMap[mId].shareOfGroup += extraPerPerson;
          }
        });
      }
    } else {
      // Equal Split
      const perPersonShare = splitWith.length > 0 ? (amount / splitWith.length) : 0;
      splitWith.forEach(mId => {
        if (memberMap[mId]) {
          memberMap[mId].shareOfGroup += perPersonShare;
          memberMap[mId].sharedTransactions.push({ ...exp, myShare: perPersonShare });
        }
      });
    }
  });

  // 2. Process Settlements (Direct transfers already made between friends)
  settlements.forEach(s => {
    const amount = Number(s.amount) || 0;
    // From person paid out cash -> reduces their debt (+ to balance)
    if (memberMap[s.from]) {
      memberMap[s.from].paidForGroup += amount;
    }
    // To person received cash -> reduces their credit (- to balance)
    if (memberMap[s.to]) {
      memberMap[s.to].shareOfGroup += amount;
    }
  });

  // 3. Compute Net Balance for each member
  const memberList = Object.values(memberMap).map(m => {
    m.netGroupBalance = Math.round((m.paidForGroup - m.shareOfGroup) * 100) / 100;
    m.totalOutPocket = Math.round((m.paidForGroup + m.personalSpend) * 100) / 100;
    return m;
  });

  // 4. Calculate Optimal Debt Simplification (Minimum Cash Flow)
  const settlementTransfers = solveMinimumTransfers(memberList);

  return {
    currency,
    totalGroupSpend: Math.round(totalGroupSpend * 100) / 100,
    totalPersonalSpend: Math.round(totalPersonalSpend * 100) / 100,
    grandTotalSpend: Math.round((totalGroupSpend + totalPersonalSpend) * 100) / 100,
    averageGroupPerPerson: members.length > 0 ? Math.round((totalGroupSpend / members.length) * 100) / 100 : 0,
    kittyBalance: Math.round((state.kitty?.balance || 0) * 100) / 100,
    categoryTotals,
    members: memberList,
    memberMap,
    settlementTransfers
  };
}

/**
 * Solves the Minimum Cash Flow problem using greedy matching of max debtor and max creditor.
 * Reduces an arbitrary web of debts down to minimal N-1 direct transactions.
 */
function solveMinimumTransfers(members) {
  // Deep clone balance array
  const balances = members.map(m => ({
    id: m.id,
    name: m.name,
    avatar: m.avatar,
    balance: Math.round(m.netGroupBalance * 100) / 100
  }));

  const transfers = [];
  const EPSILON = 0.05; // ignore tiny fractions < 5 paise

  while (true) {
    // Find biggest debtor (min negative balance) and biggest creditor (max positive balance)
    let minDebtor = null;
    let maxCreditor = null;

    for (const b of balances) {
      if (b.balance < -EPSILON) {
        if (!minDebtor || b.balance < minDebtor.balance) {
          minDebtor = b;
        }
      }
      if (b.balance > EPSILON) {
        if (!maxCreditor || b.balance > maxCreditor.balance) {
          maxCreditor = b;
        }
      }
    }

    if (!minDebtor || !maxCreditor) {
      break; // All debts resolved
    }

    // Amount to transfer is min(abs(debtor), creditor)
    const amount = Math.min(Math.abs(minDebtor.balance), maxCreditor.balance);
    const roundedAmount = Math.round(amount * 100) / 100;

    transfers.push({
      fromId: minDebtor.id,
      fromName: minDebtor.name,
      fromAvatar: minDebtor.avatar,
      toId: maxCreditor.id,
      toName: maxCreditor.name,
      toAvatar: maxCreditor.avatar,
      amount: roundedAmount
    });

    minDebtor.balance += roundedAmount;
    maxCreditor.balance -= roundedAmount;
  }

  return transfers;
}

/**
 * Generate formatted WhatsApp summary text for an individual member or whole trip
 */
export function generateIndividualReportText(memberId, summary, tripName) {
  const m = summary.memberMap[memberId];
  if (!m) return '';

  const curr = summary.currency;
  let statusText = '';
  if (m.netGroupBalance > 0.05) {
    statusText = `[GETS BACK]: ${curr} ${m.netGroupBalance.toLocaleString()}`;
  } else if (m.netGroupBalance < -0.05) {
    statusText = `[OWES]: ${curr} ${Math.abs(m.netGroupBalance).toLocaleString()}`;
  } else {
    statusText = `[SETTLED]: 0 balance`;
  }

  // Who they pay or receive from in simplified settlement
  const settlementsToPay = summary.settlementTransfers.filter(t => t.fromId === memberId);
  const settlementsToReceive = summary.settlementTransfers.filter(t => t.toId === memberId);

  let settlementText = '';
  if (settlementsToPay.length > 0) {
    settlementText += '\n*To Pay:*\n' + settlementsToPay.map(t => `- Pay ${curr}${t.amount} to ${t.toName}`).join('\n');
  }
  if (settlementsToReceive.length > 0) {
    settlementText += '\n*To Receive:*\n' + settlementsToReceive.map(t => `- Collect ${curr}${t.amount} from ${t.fromName}`).join('\n');
  }

  return `*TRIP HISAB REPORT - ${m.name.toUpperCase()}*
Trip: ${tripName}
---------------------------------
Status: ${statusText}

- Paid for Group: ${curr} ${m.paidForGroup.toLocaleString()}
- Share of Group: ${curr} ${m.shareOfGroup.toLocaleString()}
- Personal Spend: ${curr} ${m.personalSpend.toLocaleString()}
- Total Out of Pocket: ${curr} ${m.totalOutPocket.toLocaleString()}
${settlementText ? settlementText : '\nNo pending transfers.'}

Shared via Trip Hisab`;
}

/**
 * Generate comprehensive trip summary for the entire group
 */
export function generateGroupSummaryReportText(summary, tripName) {
  const curr = summary.currency;
  let text = `*${tripName.toUpperCase()} - HISAB SUMMARY*\n`;
  text += `Total Group Spend: ${curr} ${summary.totalGroupSpend.toLocaleString()}\n`;
  text += `Per Person Average: ${curr} ${summary.averageGroupPerPerson.toLocaleString()}\n`;
  text += `Kitty Balance: ${curr} ${summary.kittyBalance.toLocaleString()}\n`;
  text += `---------------------------------\n`;
  text += `*INDIVIDUAL BALANCES:*\n`;

  summary.members.forEach(m => {
    let balStr = m.netGroupBalance > 0.05
      ? `Gets ${curr}${m.netGroupBalance}`
      : (m.netGroupBalance < -0.05 ? `Owes ${curr}${Math.abs(m.netGroupBalance)}` : `Settled`);
    text += `- ${m.name}: ${balStr} (Paid: ${curr}${m.paidForGroup})\n`;
  });

  text += `---------------------------------\n`;
  text += `*FINAL SETTLEMENTS (MINIMUM TRANSFERS):*\n`;
  if (summary.settlementTransfers.length === 0) {
    text += `All accounts are completely settled!\n`;
  } else {
    summary.settlementTransfers.forEach(t => {
      text += `- ${t.fromName} pays ${curr} ${t.amount} -> ${t.toName}\n`;
    });
  }

  text += `\nTracked with Trip Hisab`;
  return text;
}
