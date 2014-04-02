# -*- coding: utf-8 -*-
__author__ = 'aohontsev'

from django.http import HttpResponse
from django.shortcuts import render


def index(request):
    return render(request, 'index.html')


def sunflower(request):
    return render(request, 'sunflower/index.html')