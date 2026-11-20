FROM mcr.microsoft.com/devcontainers/javascript-node:5.2.3-24-bookworm
# Docs ANA: PDF · 쪽 고정 내보내기(Chromium), Word · PowerPoint 변환과 비교(LibreOffice), PDF 쪽 읽기(poppler), 한글 글꼴(Noto CJK), 스킬 스크립트(Python)
RUN apt-get update && apt-get install -y --no-install-recommends tmux \
      chromium libreoffice-writer-nogui libreoffice-impress-nogui poppler-utils \
      fonts-noto-cjk python3 python3-pil \
    && rm -rf /var/lib/apt/lists/*
