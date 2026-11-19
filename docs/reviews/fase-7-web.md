# Revisão — Fase 7 (parte web) — cumulativa: Fases 1–5, 6a, 6b e 7-web

Verificação em Linux com Chromium real (ver commit). ADR 0012. **O gravador não foi feito.**

| Critério / tarefa | Estado | Evidência |
|---|---|---|
| Integrar Playwright | ✅ motor / ⚠️ Windows e empacotamento não verificados | 21 testes pytest com navegador real; e2e no Electron |
| Nós de navegação, clique, preenchimento e extração | ✅ | `web.navigate/click/fill/extract` + e2e de ponta a ponta |
| Espera por elementos | ✅ | `web.wait` (visível/oculto/presente/removido), elemento que aparece depois |
| Testes em páginas de demonstração | ✅ | servidor HTTP local (pytest e e2e) |
| Automação web usa seletores, não coordenadas | ✅ | CSS/`text=`/`role=`/`xpath=` |
| Gravador (captura, indicador, pausa, conversão, máscara) | ⏳ não iniciado | precisa protótipo em Windows (ARCHITECTURE §15) |

## Achados
1. `get_attribute("value")` devolvia o valor inicial do HTML, não o digitado → `value` agora lê o valor atual do campo (teste).
2. Não havia "fim de execução" no protocolo: sem tratamento, o navegador ficaria aberto. Resolvido **sem mudar o protocolo** (o app envia o `cancel` existente ao fim; ADR 0012). **Mutação:** remover essa chamada deixa 9 processos de Chromium abertos e o e2e falha.
3. O motor roda cada ação em thread nova e o Playwright síncrono é preso à thread → thread dedicada.
4. `--selftest` do executável congelado não pode incluir `playwright` (ainda não empacotado) → lista própria; o spike de empacotamento validado no Windows não muda.

## Segurança
Só `http/https` (`file:`, `javascript:`, `data:` recusados, testado); `fill` não registra o texto; env repassado ao motor limitado a duas variáveis; navegador novo e sem perfil persistente por execução; downloads desligados.

## Débitos / riscos
- **Windows:** Edge/Chrome via `channel`, janela visível, **empacotar playwright** (driver Node + PyInstaller) — não tentado.
- Cancelar durante o carregamento da página só vale quando ela termina/estoura o prazo.
- Sem abas/iframes, upload/download, login persistente, espera por rede ociosa.
- Seletores errados só falham em execução (o validador não os checa).
- Gravador inteiro pendente.

## O que o Hector precisa validar no Windows
1. `pip install -r engine\python\requirements-web.txt` no venv do motor e rodar um fluxo "Abrir página → Extrair" apontando para um site simples: deve abrir o Edge em segundo plano e fechar ao fim.
2. Com "Mostrar o navegador" ligado, ver a janela abrir e fechar sozinha.
3. Se aparecer `BROWSER_UNAVAILABLE`, informe a mensagem (Edge/Chrome presentes?).
