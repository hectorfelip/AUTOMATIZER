# Guia do usuário — Automation Studio

Aplicativo para Windows 11 que cria, executa e acompanha automações desenhadas como fluxos visuais. Tudo roda no seu computador; nenhum dado sai dele.

> **Estado atual:** versão de desenvolvimento (0.x), ainda sem instalador. Itens marcados com ⚠️ dependem do Windows e ainda não foram validados em uma máquina real.

## 1. Primeiros passos
1. **Dashboard** mostra o motor de automação (deve estar "Disponível"), as execuções recentes e os totais de sucesso/falha.
2. **Automações → Nova automação** cria um fluxo em branco; **Novo a partir de exemplo** traz fluxos prontos (organizar PDFs, organizar por tipo, backup condicional, Bloco de Notas…).
3. **Abrir** leva ao editor. Arraste nós da biblioteca (esquerda) para o canvas e ligue a saída de um à entrada do próximo.

## 2. O editor
- **Propriedades** (direita): configura o nó selecionado. O botão **Inserir…** oferece só variáveis e resultados que existem *naquele ponto* do fluxo.
- **Variáveis**: valores do fluxo, com tipo (texto, número, lógico). No mesmo painel: **tempo limite** do fluxo e **política de erro** (parar na primeira falha, ou continuar pelo caminho normal e terminar "com avisos").
- **Problemas**: erros impedem a execução; avisos não. Clique no problema para ir ao nó.
- **Salvar** (Ctrl+S) cria uma versão nova; versões salvas nunca são alteradas. Desfazer/Refazer: Ctrl+Z / Ctrl+Y. Duplicar: Ctrl+D.
- Fechar a tela com alterações não salvas pede confirmação.

### Expressões
Dentro de campos de texto use `{{variables.nome}}`, `{{nodes.<id>.<resultado>}}` ou `{{item.propriedade}}` (dentro de "Para cada item"). Nada é calculado além de ler esses valores.

## 3. Executar e depurar
| Botão | O que faz |
|---|---|
| **Executar** | Roda o fluxo **como está na tela** (mesmo sem salvar). |
| **Passo a passo** | Pausa antes de cada nó; use **Próximo passo** ou **Continuar**. |
| **Pausar / Continuar** | A pausa vale **ao fim do nó em andamento** (uma espera longa termina antes de pausar). |
| **Executar a partir daqui** | Começa no nó selecionado, sem rodar os anteriores; você pode dar valores iniciais às variáveis. Resultados de nós anteriores não existem nesse modo. |
| **Cancelar** | Interrompe, inclusive com a execução pausada. |

**Breakpoints:** clique no ● do nó (ou F9 com o nó selecionado) para pausar antes dele. Ficam só neste computador e não vão para o arquivo do fluxo.

O painel **Execução** mostra o nó atual, o estado de cada nó e, na pausa, as **variáveis e resultados** naquele ponto. Falhas apontam o nó e a causa.

## 4. Histórico
**Histórico** lista todas as execuções (filtros por automação, resultado e período), com log por nível, a causa da falha, o contexto final e a versão salva usada (ou "rascunho"). Sobrevive a fechar o app. Se o app fechar no meio de uma execução, ela aparece como interrompida. Limites: 2000 execuções e 5000 linhas de log cada; **Limpar histórico** apaga tudo (as automações ficam).

> Atenção: valores de variáveis aparecem no histórico. Não guarde senhas em variáveis.

## 5. Importar e exportar
- **Exportar** (lista de automações) grava a **versão salva** em um arquivo `.json`. Fluxo nunca salvo precisa ser salvo antes.
- **Importar…** mostra um **resumo** (nós, conexões, variáveis, problemas) antes de criar a automação. Importar **nunca executa** o fluxo; revise e rode você mesmo.
- Arquivos de versão desconhecida, inválidos ou de outros programas são recusados.

## 6. Configurações
Tema (claro/escuro/sistema) e **captura de tela em falhas** (desligada por padrão). Ligada, a tela é salva quando um nó falha; a imagem pode mostrar dados sensíveis, fica só neste computador e é apagada com o histórico.

## 7. O que cada ação faz e seus limites
Referência completa em `docs/ACTIONS.md`. Em resumo: nenhuma ação **apaga** arquivos; copiar/mover checam conflitos antes de alterar e só substituem com "Sobrescrever" (confirmação na tela). Mouse e teclado têm o canto superior esquerdo da tela como botão de emergência (mover o mouse até lá interrompe).

## 8. Limitações conhecidas
- ⚠️ Ações de janela, teclado e mouse (abrir app, ativar janela, digitar, atalho, clique) só funcionam no Windows e ainda não foram validadas em máquina real; cliques por coordenada dependem de resolução e escala.
- Aplicativos executados como administrador podem ignorar teclado/mouse de um app sem elevação.
- Automação de interface não funciona com a sessão bloqueada ou o usuário desconectado.
- Sem agendamento, gravador, automação web, OCR ou plugins (fases futuras).
- Listas só vêm de "Listar arquivos" (até 2000 itens).

## 9. Problemas comuns
| Mensagem | O que fazer |
|---|---|
| Motor "Indisponível" | Python 3.11+ não encontrado; veja o motivo no Dashboard. |
| "Corrija os erros do fluxo antes de executar" | Abra **Problemas** e resolva os erros. |
| "Já existem arquivos…" | Conflito no destino; nada foi alterado. Renomeie ou ligue "Sobrescrever". |
| Execução "interrompida" no histórico | O app foi fechado durante a execução. |
