// AES Chat - Landing Page Script

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCreateRoomForm();
});

// Theme Management
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('aes-theme') || 'dark';

    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('aes-theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

function updateThemeIcon(theme) {
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// Create Room Form
function initCreateRoomForm() {
    const form = document.getElementById('createRoomForm');
    const userNameInput = document.getElementById('userName');
    const roomNameInput = document.getElementById('roomName');

    // Load saved username
    const savedName = localStorage.getItem('aes-username');
    if (savedName) {
        userNameInput.value = savedName;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const userName = userNameInput.value.trim();
        const roomName = roomNameInput.value.trim();

        if (!userName) {
            showError('Please enter your name');
            return;
        }

        // Save username for future sessions
        localStorage.setItem('aes-username', userName);

        // Disable button during creation
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Creating...</span>';

        try {
            const response = await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: roomName, creatorName: userName })
            });

            const data = await response.json();

            if (data.success) {
                // Store username for the chat page
                sessionStorage.setItem('aes-joining-name', userName);
                // Redirect to room
                window.location.href = `/room/${data.roomId}`;
            } else {
                showError('Failed to create room. Please try again.');
            }
        } catch (error) {
            console.error('Error creating room:', error);
            showError('Network error. Please check your connection.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Create Room</span> →';
        }
    });
}

function showError(message) {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'toast toast-error';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #ef4444;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1000;
        animation: slideUp 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes fadeOut {
        to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    }
`;
document.head.appendChild(style);
