/* Shared Dashboard Utilities */

/* API Wrapper with Auth & Error Handling */
async function api(url, options = {}) {
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Merge options
  const finalOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, finalOptions);

    // Handle 401 - redirect to login
    if (response.status === 401) {
      window.location.href = '/login.html';
      return null;
    }

    // Handle other HTTP errors
    if (!response.ok) {
      const error = new Error(`API Error: ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    // Parse JSON response
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/* Toast Notification System */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Auto-remove after 4 seconds
  const timeout = setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);

  // Click to dismiss
  toast.addEventListener('click', () => {
    clearTimeout(timeout);
    toast.classList.add('removing');
    setTimeout(() => {
      toast.remove();
    }, 300);
  });

  return toast;
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/* Date Formatting */
function formatDate(iso) {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* Number Formatting with Commas */
function formatNumber(n) {
  if (n === null || n === undefined) return '0';
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* Duration Formatting */
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/* Load Guilds and Populate Selector */
async function loadGuilds() {
  try {
    const data = await api('/api/stats');
    const selector = document.getElementById('guild-selector');

    if (!selector) return;

    // Clear existing options
    selector.innerHTML = '';

    // Add guilds
    if (data.guilds && Array.isArray(data.guilds)) {
      data.guilds.forEach(guild => {
        const option = document.createElement('option');
        option.value = guild.id;
        option.textContent = guild.name || guild.id;
        selector.appendChild(option);
      });

      // Set current guild
      const currentGuild = getCurrentGuild();
      if (currentGuild && selector.querySelector(`option[value="${currentGuild}"]`)) {
        selector.value = currentGuild;
      } else if (selector.options.length > 0) {
        selector.value = selector.options[0].value;
        setCurrentGuild(selector.value);
      }
    }
  } catch (error) {
    console.error('Failed to load guilds:', error);
  }
}

/* Get Current Guild from localStorage */
function getCurrentGuild() {
  return localStorage.getItem('currentGuild');
}

/* Set Current Guild in localStorage */
function setCurrentGuild(id) {
  localStorage.setItem('currentGuild', id);
}

/* Initialize Navigation */
function initNav() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.sidebar-nav a');

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && currentPath.endsWith(href)) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Handle guild selector changes
  const selector = document.getElementById('guild-selector');
  if (selector) {
    selector.addEventListener('change', (e) => {
      setCurrentGuild(e.target.value);
      // Reload page to show new guild data
      window.location.reload();
    });

    // Load guilds
    loadGuilds();
  }
}

/* XSS Prevention - Escape HTML */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── Custom Modal System (replaces browser confirm/prompt/alert) ────── */

/**
 * Show a confirmation modal. Returns a Promise<boolean>.
 * @param {string} message - The message to display
 * @param {object} opts - Options: { title, confirmText, cancelText, danger, warning, icon }
 */
function showConfirm(message, opts = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const icon = opts.icon || (opts.danger ? '⚠️' : '❓');
    const title = opts.title || (opts.danger ? 'Are you sure?' : 'Confirm');
    const confirmText = opts.confirmText || (opts.danger ? 'Delete' : 'Confirm');
    const cancelText = opts.cancelText || 'Cancel';
    const btnClass = opts.danger ? 'modal-btn-danger' : opts.warning ? 'modal-btn-warning' : 'modal-btn-confirm';

    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-icon">${icon}</div>
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-message">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="modal-btn ${btnClass}" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const close = (result) => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.querySelector('[data-action="cancel"]').onclick = () => close(false);
    overlay.querySelector('[data-action="confirm"]').onclick = () => close(true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', handler); }
      if (e.key === 'Enter') { close(true); document.removeEventListener('keydown', handler); }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
    overlay.querySelector('[data-action="confirm"]').focus();
  });
}

/**
 * Show a prompt modal with text input. Returns a Promise<string|null>.
 * @param {string} message - The message to display
 * @param {object} opts - Options: { title, placeholder, defaultValue, confirmText, cancelText, icon }
 */
function showPrompt(message, opts = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const icon = opts.icon || '✏️';
    const title = opts.title || 'Input Required';
    const confirmText = opts.confirmText || 'Submit';
    const cancelText = opts.cancelText || 'Cancel';
    const placeholder = opts.placeholder || '';
    const defaultValue = opts.defaultValue || '';

    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-icon">${icon}</div>
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-message">${escapeHtml(message)}</div>
        <input class="modal-input" type="text" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}">
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="modal-btn modal-btn-confirm" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('.modal-input');

    const close = (result) => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.querySelector('[data-action="cancel"]').onclick = () => close(null);
    overlay.querySelector('[data-action="confirm"]').onclick = () => close(input.value);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', handler); }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
    input.focus();
    input.select();
  });
}

/* Initialize Page */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
});
