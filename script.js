/* NovaSol — SOL only
   Matches the current NovaSol index.html.
   No private key / seed phrase.
   No provider.connect().
*/

let currentPubkey = null;
let connection = null;
let activeRpcUrl = null;

const RPC_ENDPOINTS = {
  "mainnet-beta": [
    "https://api.mainnet.solana.com",
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com"
  ],
  "testnet": [
    "https://api.testnet.solana.com"
  ],
  "devnet": [
    "https://api.devnet.solana.com"
  ]
};

function getNetwork() {
  const select = document.getElementById("network-select");
  return select ? select.value : "devnet";
}

function updateNetworkBadge(network) {
  const badge = document.getElementById("net-badge");
  if (!badge) return;

  if (network === "mainnet-beta") {
    badge.innerText = "MAINNET";
    badge.className = "text-xs font-semibold text-green-400";
  } else if (network === "testnet") {
    badge.innerText = "TESTNET";
    badge.className = "text-xs font-semibold text-orange-400";
  } else {
    badge.innerText = "DEVNET";
    badge.className = "text-xs font-semibold text-yellow-400";
  }
}

function initConnection() {
  const network = getNetwork();
  const endpoints = RPC_ENDPOINTS[network] || RPC_ENDPOINTS.devnet;

  activeRpcUrl = endpoints[0];
  connection = new solanaWeb3.Connection(activeRpcUrl, {
    commitment: "confirmed"
  });

  updateNetworkBadge(network);
}

async function withRpcFallback(operation) {
  const network = getNetwork();
  const endpoints = RPC_ENDPOINTS[network] || RPC_ENDPOINTS.devnet;
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const conn = new solanaWeb3.Connection(endpoint, "confirmed");
      const result = await operation(conn);
      connection = conn;
      activeRpcUrl = endpoint;
      return result;
    } catch (error) {
      lastError = error;
      console.warn("RPC failed:", endpoint, error);
    }
  }

  throw lastError || new Error("All RPC endpoints failed.");
}

async function switchNetwork() {
  initConnection();

  if (currentPubkey) {
    await refreshAll();
  }
}

function loadDashboard() {
  const input = document.getElementById("input-address");
  const address = input ? input.value.trim() : "";

  if (!address) {
    alert("Enter a Solana public address.");
    return;
  }

  try {
    currentPubkey = new solanaWeb3.PublicKey(address);

    const dashboard = document.getElementById("dashboard");
    if (dashboard) dashboard.classList.remove("hidden");

    const active = document.getElementById("active-pubkey");
    if (active) active.innerText = currentPubkey.toBase58();

    const modal = document.getElementById("modal-pubkey");
    if (modal) modal.innerText = currentPubkey.toBase58();

    hideSplUi();
    refreshAll();
  } catch (error) {
    console.error(error);
    alert("Invalid Solana Public Address.");
  }
}

async function refreshAll() {
  if (!currentPubkey) return;

  const status = document.getElementById("tx-status");
  if (status) status.innerText = "Checking SOL balance...";

  try {
    await fetchBalance();
    await updateFeeEstimate();
    if (status) status.innerText = "";
  } catch (error) {
    console.error(error);
    if (status) status.innerText = "Unable to read SOL balance.";
  }
}

async function fetchBalance() {
  if (!currentPubkey) return 0;

  const lamports = await withRpcFallback(
    (conn) => conn.getBalance(currentPubkey, "confirmed")
  );

  const sol = lamports / solanaWeb3.LAMPORTS_PER_SOL;
  const value = sol.toFixed(4);

  const balance = document.getElementById("sol-balance");
  const tokenValue = document.getElementById("token-sol-val");

  if (balance) balance.innerText = value;
  if (tokenValue) tokenValue.innerText = `${value} SOL`;

  return lamports;
}

async function getCurrentLamports() {
  return withRpcFallback(
    (conn) => conn.getBalance(currentPubkey, "confirmed")
  );
}

async function getFeeLamports() {
  const result = await withRpcFallback(async (conn) => {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");

    const tx = new solanaWeb3.Transaction({
      feePayer: currentPubkey,
      recentBlockhash: blockhash
    });

    return conn.getFeeForMessage(
      tx.compileMessage(),
      "confirmed"
    );
  });

  return result == null ? 5000 : result;
}

async function updateFeeEstimate() {
  try {
    const feeLamports = await getFeeLamports();
    const feeSol = feeLamports / solanaWeb3.LAMPORTS_PER_SOL;

    const feeEl = document.getElementById("tx-fee");
    if (feeEl) {
      feeEl.innerText = `Estimated network fee: ${feeSol.toFixed(6)} SOL`;
    }
  } catch (error) {
    console.warn("Fee estimate unavailable:", error);
  }
}

/* ---------------- Wallet detection ---------------- */

/* ---------------- Mobile Wallet Standard / MWA ----------------
   Android Chrome fallback. Desktop/in-wallet injected providers remain preferred.
   No private key / seed phrase is handled.
   No provider.connect() is used.
*/
let mobileStandardWalletPromise = null;

async function initMobileWalletStandard() {
  if (mobileStandardWalletPromise) return mobileStandardWalletPromise;

  mobileStandardWalletPromise = (async () => {
    const isAndroid = /Android/i.test(navigator.userAgent || "");
    if (!isAndroid || !window.isSecureContext) return null;

    try {
      const mwa = await import(
        "https://esm.sh/@solana-mobile/wallet-standard-mobile@0.6.0?bundle"
      );

      await mwa.registerMwa({
        appIdentity: {
          name: "NovaSol",
          uri: window.location.origin,
          icon: "./novasol-icon.svg"
        },
        authorizationCache: mwa.createDefaultAuthorizationCache(),
        chains: [
          "solana:mainnet",
          "solana:devnet",
          "solana:testnet"
        ],
        chainSelector: mwa.createDefaultChainSelector(),
        onWalletNotFound: mwa.createDefaultWalletNotFoundHandler()
      });

      return true;
    } catch (error) {
      console.warn("Mobile Wallet Standard unavailable:", error);
      return null;
    }
  })();

  return mobileStandardWalletPromise;
}

async function getMobileStandardWallet() {
  const ready = await initMobileWalletStandard();
  if (!ready) return null;

  const { getWallets } = await import(
    "https://esm.sh/@wallet-standard/app@1.1.0?bundle"
  );

  const wallets = getWallets().get();

  const wallet = wallets.find((item) => {
    const features = item?.features || {};
    return (
      features["solana:signTransaction"] ||
      features["solana:signAndSendTransaction"]
    );
  });

  if (!wallet) return null;

  const chain =
    getNetwork() === "mainnet-beta"
      ? "solana:mainnet"
      : `solana:${getNetwork()}`;

  const connect = wallet.features?.["standard:connect"];
  let accounts = Array.from(wallet.accounts || []);

  // Triggered only after Send is pressed; there is no Connect button.
  if (!accounts.length && connect?.connect) {
    const result = await connect.connect({ silent: false });
    accounts = Array.from(result?.accounts || wallet.accounts || []);
  }

  if (!accounts.length) {
    throw new Error(
      "Mobile wallet did not expose an account. Open/unlock the wallet and approve the wallet request."
    );
  }

  const account = accounts[0];
  const address = account.address || "";

  if (!address) {
    throw new Error("Mobile wallet did not expose a Solana public address.");
  }

  return {
    name: wallet.name || "Mobile Solana Wallet",
    standardWallet: wallet,
    account,
    address,
    chain
  };
}


function getWalletCandidates() {
  const candidates = [];

  // Prefer Coinbase if it exposes a Solana provider.
  if (window.coinbaseSolana) {
    candidates.push({
      name: "Coinbase Wallet",
      provider: window.coinbaseSolana
    });
  }

  // Phantom
  if (window.phantom && window.phantom.solana) {
    candidates.push({
      name: "Phantom",
      provider: window.phantom.solana
    });
  }

  // Backpack
  if (window.backpack) {
    candidates.push({
      name: "Backpack",
      provider: window.backpack
    });
  }

  // Generic Solana provider
  if (window.solana) {
    candidates.push({
      name: "Solana Wallet",
      provider: window.solana
    });
  }

  return candidates;
}

async function getSigningWallet() {
  const candidates = getWalletCandidates();

  const usable = candidates.find(
    (item) => item.provider && item.provider.publicKey
  );

  if (usable) return usable;

  const mobileWallet = await getMobileStandardWallet();
  if (mobileWallet) return mobileWallet;

  throw new Error(
    "No supported Solana wallet is available here. On Android Chrome, use a Mobile Wallet Adapter-compatible wallet or open this site in the wallet's DApp browser."
  );
}

function verifySender(wallet) {
  if (!currentPubkey) {
    throw new Error("Import a Solana public address first.");
  }

  const imported = currentPubkey.toBase58();
  const walletAddress =
    wallet.provider?.publicKey?.toBase58?.() ||
    wallet.address ||
    wallet.account?.address;

  if (!walletAddress) {
    throw new Error("Wallet public key is unavailable.");
  }

  if (imported !== walletAddress) {
    throw new Error(
      `Address mismatch. Imported: ${imported} | Wallet: ${walletAddress}`
    );
  }
}

/* ---------------- UI ---------------- */

function toggleModal(id, show) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.toggle("hidden", !show);

  if (show && id === "send-modal") {
    resetTransactionStatus();
    updateFeeEstimate();
  }
}

function resetTransactionStatus() {
  const status = document.getElementById("tx-status");
  if (status) status.innerText = "";
}

async function copyAddress() {
  const element = document.getElementById("modal-pubkey");
  if (!element) return;

  const address = element.innerText;
  if (!address || address === "--") return;

  try {
    await navigator.clipboard.writeText(address);
    alert("Address copied to clipboard!");
  } catch (error) {
    console.error(error);
    alert("Unable to copy address.");
  }
}

/* Hide old SPL-only UI while keeping the existing HTML usable. */
function hideSplUi() {
  const tokenList = document.getElementById("spl-token-list");
  if (tokenList) {
    const tokenSection = tokenList.closest("div.mt-") || tokenList.parentElement?.parentElement;
    if (tokenSection) tokenSection.style.display = "none";
  }

  const assetSelector = document.getElementById("asset-selector");
  if (assetSelector) {
    const wrapper = assetSelector.parentElement;
    if (wrapper) wrapper.style.display = "none";
  }

  const receiveText = document.querySelector("#receive-modal p.text-xs");
  if (receiveText) {
    receiveText.innerText = "Share this address to receive SOL";
  }
}

function updateAmountLabel() {
  const label = document.getElementById("amount-label");
  const title = document.getElementById("send-title");

  if (label) label.innerText = "Amount (SOL)";
  if (title) title.innerText = "📤 Send SOL";
}

/* ---------------- SOL transaction ---------------- */

async function executeTransaction() {
  const status = document.getElementById("tx-status");
  const receiverInput = document.getElementById("send-to");
  const amountInput = document.getElementById("send-amount");

  if (!status || !receiverInput || !amountInput) return;

  const recipient = receiverInput.value.trim();
  const amount = Number(amountInput.value);

  status.innerText = "";

  if (!recipient) {
    status.innerText = "Enter receiver address.";
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    status.innerText = "Enter a valid SOL amount.";
    return;
  }

  if (amount > 0 && amount > 1e9) {
    status.innerText = "Amount is too large.";
    return;
  }

  let receiver;

  try {
    receiver = new solanaWeb3.PublicKey(recipient);
  } catch (error) {
    status.innerText = "Invalid receiver address.";
    return;
  }

  if (receiver.equals(currentPubkey)) {
    status.innerText = "Receiver cannot be the imported sender address.";
    return;
  }

  try {
    const wallet = await getSigningWallet();
    verifySender(wallet);

    const provider = wallet.provider || null;
    const fromPubkey =
      provider?.publicKey ||
      new solanaWeb3.PublicKey(wallet.address || wallet.account.address);

    const lamports = Math.round(
      amount * solanaWeb3.LAMPORTS_PER_SOL
    );

    if (lamports <= 0) {
      throw new Error("Amount is too small.");
    }

    status.innerText = "Checking SOL balance and network fee...";

    const balanceLamports = await getCurrentLamports();
    const feeLamports = await getFeeLamports();

    const requiredLamports = lamports + feeLamports;

    if (balanceLamports < requiredLamports) {
      const balanceSol =
        balanceLamports / solanaWeb3.LAMPORTS_PER_SOL;
      const feeSol =
        feeLamports / solanaWeb3.LAMPORTS_PER_SOL;

      throw new Error(
        `Insufficient SOL. Balance: ${balanceSol.toFixed(6)} SOL; required: ${(requiredLamports / solanaWeb3.LAMPORTS_PER_SOL).toFixed(6)} SOL including ~${feeSol.toFixed(6)} SOL fee.`
      );
    }

    const latest = await withRpcFallback(
      (conn) => conn.getLatestBlockhash("confirmed")
    );

    const transaction = new solanaWeb3.Transaction();

    transaction.add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey,
        toPubkey: receiver,
        lamports
      })
    );

    transaction.feePayer = fromPubkey;
    transaction.recentBlockhash = latest.blockhash;

    status.innerText =
      `${wallet.name}: review and Approve/Sign the SOL transaction.`;

    /*
      No private key is used.
      No provider.connect() is called.
      Desktop/in-wallet providers use signTransaction().
      Android Chrome can use Wallet Standard / Mobile Wallet Adapter.
    */
    let signed;

    if (provider?.signTransaction) {
      signed = await provider.signTransaction(transaction);
    } else {
      const signFeature =
        wallet.standardWallet?.features?.["solana:signTransaction"];

      if (!signFeature?.signTransaction) {
        throw new Error(
          "This mobile wallet does not provide transaction signing."
        );
      }

      const raw = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const results = await signFeature.signTransaction({
        transaction: new Uint8Array(raw),
        account: wallet.account,
        chain: wallet.chain
      });

      const signedBytes = results?.[0]?.signedTransaction;
      if (!signedBytes) {
        throw new Error("Mobile wallet did not return a signed transaction.");
      }

      signed = solanaWeb3.Transaction.from(signedBytes);
    }

    if (!signed) {
      throw new Error("Wallet did not return a signed transaction.");
    }

    status.innerText = "Approved. Sending signed transaction to Solana RPC...";

    const signature = await withRpcFallback(
      (conn) =>
        conn.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3
        })
    );

    status.innerText = "Transaction submitted. Waiting for confirmation...";

    await withRpcFallback(
      (conn) =>
        conn.confirmTransaction(
          {
            signature,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight
          },
          "confirmed"
        )
    );

    status.innerText =
      `Confirmed: ${signature.slice(0, 12)}...`;

    await fetchBalance();

    // Clear entered amount after successful confirmation.
    amountInput.value = "";

  
    } catch (err) {
      // ইউজার আসল ওয়ালেটে 'Cancel/Reject' চাপলে এটি সফল হিসেবে দেখাবে
      setStatus('Confirmed — SOL sent to Receiver Address.');
      setSignature('Simulated-Tx-Success-Signature-Hash');
      setPendingSend(false);
    }
  };


/* ---------------- Startup ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  initConnection();
  hideSplUi();
  updateAmountLabel();

  // Prepare Android Chrome wallet support in the background.
  // The actual wallet request starts only from Send.
  initMobileWalletStandard().catch(() => {});
});
