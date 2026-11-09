<script setup lang="ts">
import LoginView from '../../users/web/LoginView.vue'
</script>

<template>
  <LoginView title="Admin · Cantina CADB" requires="admin.access" home="/balance" />
</template>
