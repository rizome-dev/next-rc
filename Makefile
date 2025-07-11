# Makefile for building the paper

paper: paper.tex
	pdflatex paper.tex
	pdflatex paper.tex  # Run twice for references

clean:
	rm -f *.aux *.log *.out *.pdf

view: paper
	open paper.pdf || xdg-open paper.pdf || start paper.pdf

.PHONY: paper clean view