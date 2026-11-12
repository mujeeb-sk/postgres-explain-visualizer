<script setup lang="ts">
import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';

import { state, toggleTheme } from './state';
</script>

<template>
  <button
    type="button"
    class="theme-toggle btn btn-link btn-sm py-0"
    :title="state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="toggleTheme"
  >
    <FontAwesomeIcon fixed-width :icon="state.theme === 'dark' ? faMoon : faSun" />
  </button>
</template>
