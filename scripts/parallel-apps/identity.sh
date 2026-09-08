#!/usr/bin/env bash
# Source before any credential resolution or filesystem/network mutation.
case "${APP_SLUG:-}" in
  orders-api-parallel-test|inventory-api-parallel-test|shipping-api-parallel-test|customer-api-parallel-test|catalog-api-parallel-test|pricing-api-parallel-test|notification-api-parallel-test|reporting-api-parallel-test|settlement-api-parallel-test|audit-api-parallel-test) ;;
  *) echo "Unknown parallel app" >&2; exit 2 ;;
esac
export APP_SLUG
