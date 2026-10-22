// Kodar — головний скрипт
'use strict';

// Мобільне меню
document.getElementById('navToggle').addEventListener('click', function () {
  const links = document.getElementById('navLinks');
  const open = links.classList.toggle('open');
  this.setAttribute('aria-expanded', String(open));
});

// Закрити меню після вибору пункту
document.getElementById('navLinks').addEventListener('click', function (e) {
  if (e.target.tagName === 'A') this.classList.remove('open');
});

// Плавний скрол для якірних посилань
document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href.length < 2) return; // пропускаємо порожні посилання "#"
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});
